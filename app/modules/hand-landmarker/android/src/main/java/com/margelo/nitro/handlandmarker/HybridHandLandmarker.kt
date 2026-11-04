package com.margelo.nitro.handlandmarker

import android.graphics.PixelFormat
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.components.containers.Landmark as MediaPipeLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.ImageProcessingOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame

class HybridHandLandmarker(
  options: HandLandmarkerOptions,
) : HybridHandLandmarkerSpec() {
  private val landmarker: HandLandmarker = createLandmarker(options)

  // Body reference (etapa 4.3): at most one of these, only if enabled.
  private val faceDetector: FaceDetector? =
    if (options.bodyReference == BodyReferenceKind.FACE) createFaceDetector() else null
  private val poseLandmarker: PoseLandmarker? =
    if (options.bodyReference == BodyReferenceKind.POSE) createPoseLandmarker() else null

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
        return HandDetection(emptyArray(), imageWidth, imageHeight, 0.0, 0.0, emptyArray(), 0.0)
      }

      val start = System.nanoTime()
      // toBitmap() copies the pixels, so nothing outlives the frame once detect() returns.
      val mpImage = BitmapImageBuilder(image.toBitmap()).build()
      val processingOptions = ImageProcessingOptions.builder().setRotationDegrees(rotationDegrees).build()
      val timestampMs = maxOf(SystemClock.uptimeMillis(), lastTimestampMs + 1).also { lastTimestampMs = it }
      val converted = System.nanoTime()

      val result: HandLandmarkerResult
      val body: List<Landmark>
      val inferred: Long
      try {
        result = landmarker.detectForVideo(mpImage, processingOptions, timestampMs)
        inferred = System.nanoTime()
        body = detectBody(mpImage, processingOptions, timestampMs, rotationDegrees)
      } finally {
        mpImage.close()
      }
      val bodyDone = System.nanoTime()

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
        body = body.toTypedArray(),
        bodyMs = (bodyDone - inferred) / 1_000_000.0,
      )
    }
  }

  /** Runs the body reference model, if enabled, on the same image and timestamp. */
  private fun detectBody(
    image: MPImage,
    processingOptions: ImageProcessingOptions,
    timestampMs: Long,
    rotationDegrees: Int,
  ): List<Landmark> {
    faceDetector?.let { detector ->
      // The most confident face: the person signing is the closest one.
      val face =
        detector
          .detectForVideo(image, processingOptions, timestampMs)
          .detections()
          .maxByOrNull { it.categories().firstOrNull()?.score() ?: 0f }
      val keypoints = face?.keypoints()?.orElse(null) ?: return emptyList()
      return keypoints.map { upright(it.x().toDouble(), it.y().toDouble(), 0.0, rotationDegrees) }
    }
    poseLandmarker?.let { landmarker ->
      val pose = landmarker.detectForVideo(image, processingOptions, timestampMs).landmarks().firstOrNull()
      // Points 0-12: nose, eyes, ears, mouth corners, shoulders. The rest is below the chest.
      return pose?.take(POSE_UPPER_BODY_POINTS)?.map { it.toUpright(rotationDegrees) } ?: emptyList()
    }
    return emptyList()
  }

  /**
   * MediaPipe uses the rotation to run inference on an upright hand, but returns
   * landmarks in the coordinates of the sensor image (e.g. sideways on phones).
   * Rotate them clockwise by [rotationDegrees] so they match the upright image.
   * Verified on a Xiaomi front camera (sensor at 270°).
   */
  private fun NormalizedLandmark.toUpright(rotationDegrees: Int): Landmark =
    upright(x().toDouble(), y().toDouble(), z().toDouble(), rotationDegrees)

  /** Same rotation for any normalized point (hand and pose landmarks, face keypoints). */
  private fun upright(x: Double, y: Double, z: Double, rotationDegrees: Int): Landmark =
    when (rotationDegrees) {
      90 -> Landmark(1 - y, x, z)
      180 -> Landmark(1 - x, 1 - y, z)
      270 -> Landmark(y, 1 - x, z)
      else -> Landmark(x, y, z)
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
        faceDetector?.close()
        poseLandmarker?.close()
      }
    }
  }

  private companion object {
    const val POSE_UPPER_BODY_POINTS = 13

    val context
      get() =
        NitroModules.applicationContext
          ?: throw Error("No application context available to load the MediaPipe models.")

    // GPU fails on the emulator; CPU works everywhere and can be called from any thread.
    fun baseOptions(model: String): BaseOptions =
      BaseOptions.builder().setModelAssetPath(model).setDelegate(Delegate.CPU).build()

    fun createLandmarker(options: HandLandmarkerOptions): HandLandmarker {
      val landmarkerOptions =
        HandLandmarker.HandLandmarkerOptions
          .builder()
          .setBaseOptions(baseOptions("hand_landmarker.task"))
          .setRunningMode(RunningMode.VIDEO)
          .setNumHands(options.numHands.toInt())
          .setMinHandDetectionConfidence(options.minHandDetectionConfidence.toFloat())
          .setMinHandPresenceConfidence(options.minHandPresenceConfidence.toFloat())
          .setMinTrackingConfidence(options.minTrackingConfidence.toFloat())
          .build()
      return HandLandmarker.createFromOptions(context, landmarkerOptions)
    }

    fun createFaceDetector(): FaceDetector {
      val detectorOptions =
        FaceDetector.FaceDetectorOptions
          .builder()
          .setBaseOptions(baseOptions("blaze_face_short_range.tflite"))
          .setRunningMode(RunningMode.VIDEO)
          .build()
      return FaceDetector.createFromOptions(context, detectorOptions)
    }

    fun createPoseLandmarker(): PoseLandmarker {
      val landmarkerOptions =
        PoseLandmarker.PoseLandmarkerOptions
          .builder()
          .setBaseOptions(baseOptions("pose_landmarker_lite.task"))
          .setRunningMode(RunningMode.VIDEO)
          .setNumPoses(1)
          .build()
      return PoseLandmarker.createFromOptions(context, landmarkerOptions)
    }
  }
}
