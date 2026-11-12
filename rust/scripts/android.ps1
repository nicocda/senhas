# Builds the Rust app, packages it as an APK and installs it (ADR 0013).
#
#   powershell -File rust/scripts/android.ps1              emulator (x86_64), debug APK
#   powershell -File rust/scripts/android.ps1 -Phone       phone by USB (arm64-v8a), release APK
#
# The Rust part is always built in release mode: in debug, the image math runs ~20x slower.
param([switch]$Phone)
$ErrorActionPreference = 'Stop'

$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_HOME = $sdk
$env:ANDROID_NDK_HOME = Join-Path $sdk 'ndk\27.1.12297006'
# Slint's Android backend compiles a small Java helper: it needs android.jar. Its
# search doesn't recognize folders named like "android-37.0", so it's given directly.
$platform = Get-ChildItem (Join-Path $sdk 'platforms') | Sort-Object Name | Select-Object -Last 1
$env:ANDROID_JAR = Join-Path $platform.FullName 'android.jar'

$rust = Join-Path $PSScriptRoot '..'
$android = Join-Path $rust 'android'
$abi = if ($Phone) { 'arm64-v8a' } else { 'x86_64' }
$device = if ($Phone) { '-d' } else { '-e' }

Push-Location $rust
try {
  cargo ndk -t $abi -P 26 -o (Join-Path $android 'app\src\main\jniLibs') build --release -p senhas-app
  if ($LASTEXITCODE -ne 0) { throw 'cargo ndk failed' }
} finally { Pop-Location }

Push-Location $android
try {
  $task = if ($Phone) { 'assembleRelease' } else { 'assembleDebug' }
  .\gradlew.bat $task
  if ($LASTEXITCODE -ne 0) { throw 'gradle failed' }
  $apk = if ($Phone) { 'app\build\outputs\apk\release\app-release.apk' } else { 'app\build\outputs\apk\debug\app-debug.apk' }
  adb $device install -r $apk
  if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }
  adb $device shell am start -n com.nicogiordano.senhas.rust/android.app.NativeActivity
} finally { Pop-Location }
