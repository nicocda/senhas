# R8 keep rules for MediaPipe, applied to any app that uses this module
# (consumerProguardFiles). MediaPipe's AARs ship none.
#
# Why: MediaPipe reads its protobuf messages by reflection (field names like
# hostEnvironment_ or length_) and its native code calls Java by name. R8 only sees
# static references, so in a release build it renames or removes them and
# HandLandmarker.createFromOptions crashes ("Field ... not found").
# Rules recommended by a MediaPipe maintainer:
# https://github.com/google-ai-edge/mediapipe/issues/6088

-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
  <fields>;
}
-dontwarn com.google.mediapipe.**
-dontwarn com.google.protobuf.**
