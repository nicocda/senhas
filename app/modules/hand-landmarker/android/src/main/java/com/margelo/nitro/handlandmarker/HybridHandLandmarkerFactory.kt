package com.margelo.nitro.handlandmarker

import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

@DoNotStrip
@Keep
class HybridHandLandmarkerFactory : HybridHandLandmarkerFactorySpec() {
  @DoNotStrip
  @Keep
  override fun createHandLandmarker(options: HandLandmarkerOptions): HybridHandLandmarkerSpec {
    return HybridHandLandmarker(options)
  }
}
