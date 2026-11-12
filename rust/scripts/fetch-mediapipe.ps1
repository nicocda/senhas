# Downloads MediaPipe's models (same URLs as app/modules/hand-landmarker/android/build.gradle)
# and its public test images into rust/mediapipe/ (outside git).
#
#   powershell -File rust/scripts/fetch-mediapipe.ps1
#
# Then, for the parity test of hand-pipeline, run the reference with a Python that has
# `mediapipe` (see crates/hand-pipeline/reference/mediapipe_reference.py).
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\mediapipe'
$testdata = Join-Path $root 'testdata'
New-Item -ItemType Directory -Force $testdata | Out-Null

$models = @{
  'hand_landmarker.task'          = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
  'blaze_face_short_range.tflite' = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
}
foreach ($name in $models.Keys) {
  Invoke-WebRequest -Uri $models[$name] -OutFile (Join-Path $root $name)
}

# A .task file is a zip with the two hand models.
$zip = Join-Path $root 'hand_landmarker.zip'
Copy-Item (Join-Path $root 'hand_landmarker.task') $zip
Expand-Archive -Path $zip -DestinationPath $root -Force
Remove-Item $zip

# MediaPipe's own test images (mediapipe/tasks/testdata/vision).
$images = 'thumb_up', 'pointing_up', 'pointing_up_rotated', 'right_hands', 'left_hands', 'victory', 'portrait'
foreach ($name in $images) {
  Invoke-WebRequest -Uri "https://storage.googleapis.com/mediapipe-assets/$name.jpg" -OutFile (Join-Path $testdata "$name.jpg")
}
Get-ChildItem $root -Recurse -File | Select-Object Name, Length
