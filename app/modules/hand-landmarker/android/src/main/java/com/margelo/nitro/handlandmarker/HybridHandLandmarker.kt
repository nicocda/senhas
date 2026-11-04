package com.margelo.nitro.handlandmarker

import android.graphics.PixelFormat
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.components.containers.Landmark as MediaPipeLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame

class HybridHandLandmarker(
  options: HandLandmarkerOptions,
) : HybridHandLandmarkerSpec() {
  private val landmarker: HandLandmarker = createLandmarker(options)

  // VIDEO mode requires strictly increasing timestamps.
  private var lastTimestampMs = -1L

  // detect() runs on the camera thread and dispose() on the JS thread. Closing
  // MediaPipe in the middle of an inference frees memory it is still using, so
  // both take this lock.
  private val lock = Any()
  private var isClosed = false

  override fun detect(frame: HybridFrameSpec): HandDetection {
    val image =
      (frame as? NativeFrame)?.image
        ?: throw Error("Frame is not a NativeFrame!")
    if (image.format != PixelFormat.RGBA_8888) {
      // MediaPipe only accepts RGBA input; YUV must be converted before it gets here.
      throw Error("HandLandmarker needs a frame output with pixelFormat 'rgb' (got format ${image.format}).")
    }

    val rotationDegrees = image.imageInfo.rotationDegrees
    // Landmarks are returned normalized to the upright image.
    val isSideways = rotationDegrees % 180 != 0
    val imageWidth = (if (isSideways) image.height else image.width).toDouble()
    val imageHeight = (if (isSideways) image.width else image.height).toDouble()

    synchronized(lock) {
      if (isClosed) {
        // A frame already in flight when JS replaces this landmarker (e.g. to
        // change numHands) gets no hands; the next frame uses the new instance.
        return HandDetection(emptyArray(), imageWidth, imageHeight, 0.0, 0.0)
      }

      val start = System.nanoTime()
      // toBitmap() copies the pixels, so nothing outlives the frame once detect() returns.
      val mpImage = BitmapImageBuilder(image.toBitmap()).build()
      val processingOptions = ImageProcessingOptions.builder().setRotationDegrees(rotationDegrees).build()
      val timestampMs = maxOf(SystemClock.uptimeMillis(), lastTimestampMs + 1).also { lastTimestampMs = it }
      val converted = System.nanoTime()

      val result =
        try {
          landmarker.detectForVideo(mpImage, processingOptions, timestampMs)
        } finally {
          mpImage.close()
        }
      val inferred = System.nanoTime()

      val hands =
        result.landmarks().mapIndexed { i, points ->
          val category = result.handedness()[i].first()
          DetectedHand(
            landmarks = points.map { it.toUpright(rotationDegrees) }.toTypedArray(),
            worldLandmarks = result.worldLandmarks()[i].map { it.toUpright(rotationDegrees) }.toTypedArray(),
            handedness = if (category.categoryName() == "Left") Handedness.LEFT else Handedness.RIGHT,
            score = category.score().toDouble(),
          )
        }

      return HandDetection(
        hands = hands.toTypedArray(),
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        conversionMs = (converted - start) / 1_000_000.0,
        inferenceMs = (inferred - converted) / 1_000_000.0,
      )
    }
  }

  /**
   * MediaPipe uses the rotation to run inference on an upright hand, but returns
   * landmarks in the coordinates of the sensor image (e.g. sideways on phones).
   * Rotate them clockwise by [rotationDegrees] so they match the upright image.
   * Verified on a Xiaomi front camera (sensor at 270°).
   */
  private fun NormalizedLandmark.toUpright(rotationDegrees: Int): Landmark {
    val x = x().toDouble()
    val y = y().toDouble()
    val z = z().toDouble()
    return when (rotationDegrees) {
      90 -> Landmark(1 - y, x, z)
      180 -> Landmark(1 - x, 1 - y, z)
      270 -> Landmark(y, 1 - x, z)
      else -> Landmark(x, y, z)
    }
  }

  /**
   * World landmarks are rotated with the same hand rect as the normalized ones
   * (MediaPipe's WorldLandmarkProjectionCalculator), so they are also in sensor
   * orientation. They are centered on the hand, so the rotation has no `1 -` offset.
   */
  private fun MediaPipeLandmark.toUpright(rotationDegrees: Int): Landmark {
    val x = x().toDouble()
    val y = y().toDouble()
    val z = z().toDouble()
    return when (rotationDegrees) {
      90 -> Landmark(-y, x, z)
      180 -> Landmark(-x, -y, z)
      270 -> Landmark(y, -x, z)
      else -> Landmark(x, y, z)
    }
  }

  override fun dispose() {
    super.dispose()
    // Waits for an in-flight detect() to finish before freeing MediaPipe.
    synchronized(lock) {
      if (!isClosed) {
        isClosed = true
        landmarker.close()
      }
    }
  }

  private fun createLandmarker(options: HandLandmarkerOptions): HandLandmarker {
    val context =
      NitroModules.applicationContext
        ?: throw Error("No application context available to load the MediaPipe model.")
    val baseOptions =
      BaseOptions
        .builder()
        .setModelAssetPath("hand_landmarker.task")
        // GPU fails on the emulator; CPU works everywhere and can be called from any thread.
        .setDelegate(Delegate.CPU)
        .build()
    val landmarkerOptions =
      HandLandmarker.HandLandmarkerOptions
        .builder()
        .setBaseOptions(baseOptions)
        .setRunningMode(RunningMode.VIDEO)
        .setNumHands(options.numHands.toInt())
        .setMinHandDetectionConfidence(options.minHandDetectionConfidence.toFloat())
        .setMinHandPresenceConfidence(options.minHandPresenceConfidence.toFloat())
        .setMinTrackingConfidence(options.minTrackingConfidence.toFloat())
        .build()
    return HandLandmarker.createFromOptions(context, landmarkerOptions)
  }
}
