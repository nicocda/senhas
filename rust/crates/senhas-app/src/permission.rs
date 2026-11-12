//! The camera permission. Android only grants it through Java
//! (`Activity.requestPermissions`), so this calls the activity over JNI: the one
//! place where the app still needs Java's runtime, though not a line of Java.

use std::time::Duration;

use jni::JavaVM;
use jni::objects::{JObject, JValue};
use slint::android::AndroidApp;

const CAMERA: &str = "android.permission.CAMERA";
const GRANTED: i32 = 0;

/// Asks for the camera permission if needed, then waits until it's granted.
pub fn wait_for_camera(app: &AndroidApp) -> jni::errors::Result<()> {
    // SAFETY: android-activity gives the process's JavaVM and the activity.
    let vm = unsafe { JavaVM::from_raw(app.vm_as_ptr().cast())? };
    let activity = unsafe { JObject::from_raw(app.activity_as_ptr().cast()) };
    let mut env = vm.attach_current_thread()?;
    let permission = env.new_string(CAMERA)?;
    let granted = |env: &mut jni::JNIEnv| -> jni::errors::Result<bool> {
        let status = env.call_method(
            &activity,
            "checkSelfPermission",
            "(Ljava/lang/String;)I",
            &[JValue::Object(&permission)],
        )?;
        Ok(status.i()? == GRANTED)
    };
    if granted(&mut env)? {
        return Ok(());
    }
    let list = env.new_object_array(1, "java/lang/String", &permission)?;
    env.call_method(
        &activity,
        "requestPermissions",
        "([Ljava/lang/String;I)V",
        &[JValue::Object(&list), JValue::Int(0)],
    )?;
    // The answer goes to the activity's Java callback; polling is simpler than
    // hooking it.
    while !granted(&mut env)? {
        std::thread::sleep(Duration::from_millis(300));
    }
    Ok(())
}
