//! The front camera through the NDK's Camera2 C API (`ACameraManager`) and an
//! `AImageReader`: no Java, no `CameraX`. Each frame arrives as YUV 4:2:0 and is
//! turned into an upright RGB image, like the image the Kotlin plugin gives
//! `MediaPipe` (`HybridHandLandmarker.kt`: rotated by the sensor orientation, not
//! mirrored).

use std::ffi::{CStr, c_void};
use std::ptr;

use hand_pipeline::image::RgbImage;
use ndk_sys as sys;

// The NDK camera functions live in libcamera2ndk.so; ndk-sys declares them but
// doesn't link it.
#[link(name = "camera2ndk")]
unsafe extern "C" {}

/// Camera resolution (landscape, as the sensor gives it). Upright: 720 x 1280, the
/// same as the React Native app.
const WIDTH: i32 = 1280;
const HEIGHT: i32 = 720;
const MAX_IMAGES: i32 = 3;
const LENS_FACING_FRONT: u8 = 0;
const LENS_FACING_BACK: u8 = 1;

/// Which camera: the front one, as in the React Native app, unless the developer
/// property `debug.senhas.camera` is `back`. The emulator's back camera is a
/// virtual scene: handy when there's no webcam, and it films nobody.
#[must_use]
pub fn wanted_facing() -> u8 {
    let mut value = [0u8; 92]; // PROP_VALUE_MAX
    // SAFETY: the name is NUL-terminated and the buffer has PROP_VALUE_MAX bytes.
    let length = unsafe {
        libc::__system_property_get(c"debug.senhas.camera".as_ptr(), value.as_mut_ptr().cast())
    };
    if &value[..length.max(0) as usize] == b"back" {
        LENS_FACING_BACK
    } else {
        LENS_FACING_FRONT
    }
}

pub type FrameCallback = Box<dyn FnMut(RgbImage) + Send>;

/// Context the NDK callbacks get back: the frame callback and the sensor rotation.
struct Listener {
    on_frame: FrameCallback,
    rotation: i32,
}

/// An open camera streaming frames. Closes everything when dropped.
pub struct Camera {
    manager: *mut sys::ACameraManager,
    device: *mut sys::ACameraDevice,
    reader: *mut sys::AImageReader,
    session: *mut sys::ACameraCaptureSession,
    request: *mut sys::ACaptureRequest,
    outputs: *mut sys::ACaptureSessionOutputContainer,
    output: *mut sys::ACaptureSessionOutput,
    target: *mut sys::ACameraOutputTarget,
    listener: *mut Listener,
}

// The raw handles are only touched on open and drop; the NDK is thread safe for these.
unsafe impl Send for Camera {}

#[derive(Debug)]
pub struct CameraError(pub String);

impl std::fmt::Display for CameraError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn check(status: sys::camera_status_t, what: &str) -> Result<(), CameraError> {
    if status == sys::camera_status_t::ACAMERA_OK {
        Ok(())
    } else {
        Err(CameraError(format!("{what}: camera status {}", status.0)))
    }
}

fn check_media(status: sys::media_status_t, what: &str) -> Result<(), CameraError> {
    if status == sys::media_status_t::AMEDIA_OK {
        Ok(())
    } else {
        Err(CameraError(format!("{what}: media status {}", status.0)))
    }
}

impl Camera {
    /// Opens the camera facing `facing` and starts calling `on_frame` from a camera thread.
    pub fn open(facing: u8, on_frame: FrameCallback) -> Result<Self, CameraError> {
        unsafe {
            let manager = sys::ACameraManager_create();
            let (id, rotation) = find_camera(manager, facing)?;
            log::info!("Camera {id:?} (facing {facing}), sensor orientation {rotation}°");

            let mut camera = Self {
                manager,
                device: ptr::null_mut(),
                reader: ptr::null_mut(),
                session: ptr::null_mut(),
                request: ptr::null_mut(),
                outputs: ptr::null_mut(),
                output: ptr::null_mut(),
                target: ptr::null_mut(),
                listener: Box::into_raw(Box::new(Listener { on_frame, rotation })),
            };

            let mut device_callbacks = sys::ACameraDevice_StateCallbacks {
                context: ptr::null_mut(),
                onDisconnected: Some(on_disconnected),
                onError: Some(on_error),
            };
            check(
                sys::ACameraManager_openCamera(
                    manager,
                    id.as_ptr(),
                    &raw mut device_callbacks,
                    &raw mut camera.device,
                ),
                "openCamera",
            )?;

            check_media(
                sys::AImageReader_new(
                    WIDTH,
                    HEIGHT,
                    sys::AIMAGE_FORMATS::AIMAGE_FORMAT_YUV_420_888.0 as i32,
                    MAX_IMAGES,
                    &raw mut camera.reader,
                ),
                "AImageReader_new",
            )?;
            let mut image_listener = sys::AImageReader_ImageListener {
                context: camera.listener.cast(),
                onImageAvailable: Some(on_image),
            };
            check_media(
                sys::AImageReader_setImageListener(camera.reader, &raw mut image_listener),
                "setImageListener",
            )?;
            let mut window = ptr::null_mut();
            check_media(
                sys::AImageReader_getWindow(camera.reader, &raw mut window),
                "getWindow",
            )?;
            camera.start_session(window)?;
            Ok(camera)
        }
    }

    /// A capture session that repeats a preview request into `window` (the reader's).
    unsafe fn start_session(&mut self, window: *mut sys::ANativeWindow) -> Result<(), CameraError> {
        let camera = self;
        unsafe {
            check(
                sys::ACaptureSessionOutputContainer_create(&raw mut camera.outputs),
                "outputs",
            )?;
            check(
                sys::ACaptureSessionOutput_create(window, &raw mut camera.output),
                "output",
            )?;
            check(
                sys::ACaptureSessionOutputContainer_add(camera.outputs, camera.output),
                "add output",
            )?;
            check(
                sys::ACameraOutputTarget_create(window, &raw mut camera.target),
                "target",
            )?;
            check(
                sys::ACameraDevice_createCaptureRequest(
                    camera.device,
                    sys::ACameraDevice_request_template::TEMPLATE_PREVIEW,
                    &raw mut camera.request,
                ),
                "createCaptureRequest",
            )?;
            check(
                sys::ACaptureRequest_addTarget(camera.request, camera.target),
                "addTarget",
            )?;

            let session_callbacks = sys::ACameraCaptureSession_stateCallbacks {
                context: ptr::null_mut(),
                onClosed: None,
                onReady: None,
                onActive: None,
            };
            check(
                sys::ACameraDevice_createCaptureSession(
                    camera.device,
                    camera.outputs,
                    &raw const session_callbacks,
                    &raw mut camera.session,
                ),
                "createCaptureSession",
            )?;
            let mut requests = [camera.request];
            check(
                sys::ACameraCaptureSession_setRepeatingRequest(
                    camera.session,
                    ptr::null_mut(),
                    1,
                    requests.as_mut_ptr(),
                    ptr::null_mut(),
                ),
                "setRepeatingRequest",
            )
        }
    }
}

impl Drop for Camera {
    fn drop(&mut self) {
        unsafe {
            if !self.session.is_null() {
                sys::ACameraCaptureSession_stopRepeating(self.session);
                sys::ACameraCaptureSession_close(self.session);
            }
            if !self.request.is_null() {
                sys::ACaptureRequest_free(self.request);
            }
            if !self.target.is_null() {
                sys::ACameraOutputTarget_free(self.target);
            }
            if !self.output.is_null() {
                sys::ACaptureSessionOutput_free(self.output);
            }
            if !self.outputs.is_null() {
                sys::ACaptureSessionOutputContainer_free(self.outputs);
            }
            if !self.device.is_null() {
                sys::ACameraDevice_close(self.device);
            }
            if !self.reader.is_null() {
                sys::AImageReader_delete(self.reader);
            }
            sys::ACameraManager_delete(self.manager);
            drop(Box::from_raw(self.listener));
        }
    }
}

/// The first camera facing `facing`: its id and sensor orientation (degrees).
unsafe fn find_camera(
    manager: *mut sys::ACameraManager,
    facing: u8,
) -> Result<(std::ffi::CString, i32), CameraError> {
    unsafe {
        let mut list = ptr::null_mut();
        check(
            sys::ACameraManager_getCameraIdList(manager, &raw mut list),
            "getCameraIdList",
        )?;
        let ids = std::slice::from_raw_parts((*list).cameraIds, (*list).numCameras as usize);
        let mut found = None;
        for &id in ids {
            let mut metadata = ptr::null_mut();
            if sys::ACameraManager_getCameraCharacteristics(manager, id, &raw mut metadata)
                != sys::camera_status_t::ACAMERA_OK
            {
                continue;
            }
            let mut entry = std::mem::zeroed::<sys::ACameraMetadata_const_entry>();
            let facing = sys::ACameraMetadata_getConstEntry(
                metadata,
                sys::acamera_metadata_tag::ACAMERA_LENS_FACING.0,
                &raw mut entry,
            ) == sys::camera_status_t::ACAMERA_OK
                && *entry.data.u8_ == facing;
            let mut rotation = 0;
            if sys::ACameraMetadata_getConstEntry(
                metadata,
                sys::acamera_metadata_tag::ACAMERA_SENSOR_ORIENTATION.0,
                &raw mut entry,
            ) == sys::camera_status_t::ACAMERA_OK
            {
                rotation = *entry.data.i32_;
            }
            sys::ACameraMetadata_free(metadata);
            if facing {
                found = Some((CStr::from_ptr(id).to_owned(), rotation));
                break;
            }
        }
        sys::ACameraManager_deleteCameraIdList(list);
        found.ok_or_else(|| CameraError(format!("no camera facing {facing}")))
    }
}

unsafe extern "C" fn on_disconnected(_: *mut c_void, _: *mut sys::ACameraDevice) {
    log::warn!("Camera disconnected");
}

unsafe extern "C" fn on_error(_: *mut c_void, _: *mut sys::ACameraDevice, error: i32) {
    log::error!("Camera error {error}");
}

/// Camera thread: the newest image (older ones are dropped if we're slow).
unsafe extern "C" fn on_image(context: *mut c_void, reader: *mut sys::AImageReader) {
    unsafe {
        let mut image = ptr::null_mut();
        if sys::AImageReader_acquireLatestImage(reader, &raw mut image)
            != sys::media_status_t::AMEDIA_OK
        {
            return;
        }
        let listener = &mut *context.cast::<Listener>();
        if let Some(rgb) = upright_rgb(image, listener.rotation) {
            (listener.on_frame)(rgb);
        }
        sys::AImage_delete(image);
    }
}

struct Plane {
    data: *const u8,
    row_stride: usize,
    pixel_stride: usize,
}

unsafe fn plane(image: *const sys::AImage, index: i32) -> Option<Plane> {
    unsafe {
        let (mut data, mut length, mut row, mut pixel) = (ptr::null_mut(), 0, 0, 0);
        let ok = sys::AImage_getPlaneData(image, index, &raw mut data, &raw mut length)
            == sys::media_status_t::AMEDIA_OK
            && sys::AImage_getPlaneRowStride(image, index, &raw mut row)
                == sys::media_status_t::AMEDIA_OK
            && sys::AImage_getPlanePixelStride(image, index, &raw mut pixel)
                == sys::media_status_t::AMEDIA_OK;
        ok.then_some(Plane {
            data,
            row_stride: row as usize,
            pixel_stride: pixel as usize,
        })
    }
}

/// YUV 4:2:0 (any layout: planar or interleaved) -> RGB, rotated clockwise by the
/// sensor orientation so the person is upright. Full-range BT.601, as Android cameras give.
unsafe fn upright_rgb(image: *const sys::AImage, rotation: i32) -> Option<RgbImage> {
    unsafe {
        let (mut w, mut h) = (0, 0);
        sys::AImage_getWidth(image, &raw mut w);
        sys::AImage_getHeight(image, &raw mut h);
        let (w, h) = (w as usize, h as usize);
        let (y_plane, u_plane, v_plane) = (plane(image, 0)?, plane(image, 1)?, plane(image, 2)?);
        let (out_w, out_h) = if rotation % 180 == 0 { (w, h) } else { (h, w) };
        let mut data = vec![0u8; out_w * out_h * 3];
        for sy in 0..h {
            let y_row = y_plane.data.add(sy * y_plane.row_stride);
            let u_row = u_plane.data.add((sy / 2) * u_plane.row_stride);
            let v_row = v_plane.data.add((sy / 2) * v_plane.row_stride);
            for sx in 0..w {
                let luma = f32::from(*y_row.add(sx * y_plane.pixel_stride));
                let u = f32::from(*u_row.add((sx / 2) * u_plane.pixel_stride)) - 128.0;
                let v = f32::from(*v_row.add((sx / 2) * v_plane.pixel_stride)) - 128.0;
                let (dx, dy) = match rotation {
                    90 => (h - 1 - sy, sx),
                    180 => (w - 1 - sx, h - 1 - sy),
                    270 => (sy, w - 1 - sx),
                    _ => (sx, sy),
                };
                let out = &mut data[(dy * out_w + dx) * 3..][..3];
                out[0] = (luma + 1.402 * v).clamp(0.0, 255.0) as u8;
                out[1] = (luma - 0.344_136 * u - 0.714_136 * v).clamp(0.0, 255.0) as u8;
                out[2] = (luma + 1.772 * u).clamp(0.0, 255.0) as u8;
            }
        }
        Some(RgbImage {
            width: out_w,
            height: out_h,
            data,
        })
    }
}
