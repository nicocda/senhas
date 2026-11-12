//! The Android runtime: entry point, lifecycle, camera thread and recognizer thread.
//!
//! Three threads: Slint's UI loop (main), the camera's (the NDK calls back with
//! each frame: it's shown right away and left for the recognizer) and the
//! recognizer's (always takes the newest frame, so a slow model drops frames
//! instead of falling behind).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Instant;

use hand_pipeline::image::RgbImage;
use slint::ComponentHandle;
use slint::android::AndroidApp;
use slint::android::android_activity::{MainEvent, PollEvent};

use crate::{App, camera, display_buffer, permission, recognizer, skeleton_path};

/// Whether the activity is on screen. The camera can only be opened in the
/// foreground (Android rejects it from the background), and it's closed when the
/// app leaves it, like the React Native app (`use-is-foreground.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lifecycle {
    Foreground,
    Background,
}

#[unsafe(no_mangle)]
#[expect(
    clippy::no_mangle_with_rust_abi,
    reason = "android-activity calls android_main with the Rust ABI"
)]
fn android_main(app: AndroidApp) {
    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Info)
            .with_tag("senhas"),
    );
    let (lifecycle, events) = mpsc::channel();
    slint::android::init_with_event_listener(app.clone(), move |event| {
        let state = match event {
            PollEvent::Main(MainEvent::Resume { .. }) => Lifecycle::Foreground,
            PollEvent::Main(MainEvent::Pause) => Lifecycle::Background,
            _ => return,
        };
        let _ = lifecycle.send(state);
    })
    .expect("Slint Android backend");

    let ui = App::new().expect("UI");
    let frames = Arc::new(LatestFrame::default());
    let clear = Arc::new(AtomicBool::new(false));
    ui.on_clear({
        let clear = clear.clone();
        move || clear.store(true, Ordering::Relaxed)
    });

    std::thread::spawn({
        let (ui, frames) = (ui.as_weak(), frames.clone());
        move || recognize(&frames, &clear, &ui)
    });
    std::thread::spawn({
        let ui = ui.as_weak();
        move || {
            if let Err(error) = permission::wait_for_camera(&app) {
                log::error!("Camera permission: {error}");
                return;
            }
            run_camera(&events, &frames, &ui);
        }
    });

    ui.run().expect("event loop");
}

/// The newest camera frame, waiting for the recognizer. A frame that arrives while
/// the recognizer is busy replaces the previous one.
#[derive(Default)]
struct LatestFrame {
    slot: Mutex<Option<RgbImage>>,
    ready: Condvar,
}

impl LatestFrame {
    fn put(&self, image: RgbImage) {
        *self.slot.lock().expect("frame slot") = Some(image);
        self.ready.notify_one();
    }

    fn take(&self) -> RgbImage {
        let mut slot = self.slot.lock().expect("frame slot");
        loop {
            if let Some(image) = slot.take() {
                return image;
            }
            slot = self.ready.wait(slot).expect("frame slot");
        }
    }
}

/// Opens the camera while the app is in the foreground, closes it when it leaves.
fn run_camera(events: &Receiver<Lifecycle>, frames: &Arc<LatestFrame>, ui: &slint::Weak<App>) {
    let mut camera = None;
    while let Ok(event) = events.recv() {
        let mut foreground = event == Lifecycle::Foreground;
        // Only the latest state matters (e.g. paused and resumed by the permission dialog).
        for event in events.try_iter() {
            foreground = event == Lifecycle::Foreground;
        }
        if !foreground {
            if camera.take().is_some() {
                log::info!("Camera closed (background)");
            }
            continue;
        }
        if let Some(image) = test_image() {
            // Developer mode: a still image instead of the camera, ~15 times a second.
            let handler = frame_handler(ui.clone(), frames.clone(), camera::LENS_FACING_BACK);
            std::thread::spawn(move || feed_still(&image, handler));
            return;
        }
        if camera.is_none() {
            let facing = camera::wanted_facing();
            let handler = frame_handler(ui.clone(), frames.clone(), facing);
            match camera::Camera::open(facing, handler) {
                Ok(opened) => camera = Some(opened),
                Err(error) => log::error!("Camera: {error}"),
            }
        }
    }
}

/// `debug.senhas.image`: a PPM file to use instead of the camera, e.g. `MediaPipe`'s
/// public test images copied to the app's folder (`/sdcard/Android/data/<app>/files`):
/// lets the whole Detectar path be tested on a device without filming anyone.
fn test_image() -> Option<RgbImage> {
    let path = camera::developer_property(c"debug.senhas.image");
    if path.is_empty() {
        return None;
    }
    match RgbImage::read_ppm(std::path::Path::new(&path)) {
        Ok(image) => {
            log::info!("Test image {path}: {} x {}", image.width, image.height);
            Some(image)
        }
        Err(error) => {
            log::error!("Test image {path}: {error}");
            None
        }
    }
}

fn feed_still(image: &RgbImage, mut handler: camera::FrameCallback) {
    loop {
        handler(image.clone());
        std::thread::sleep(std::time::Duration::from_millis(66));
    }
}

/// Camera thread: shows each frame and leaves it for the recognizer.
fn frame_handler(
    ui: slint::Weak<App>,
    frames: Arc<LatestFrame>,
    facing: u8,
) -> camera::FrameCallback {
    let mirror = facing == camera::LENS_FACING_FRONT;
    Box::new(move |image: RgbImage| {
        let buffer = display_buffer(&image, mirror);
        frames.put(image);
        let ui = ui.clone();
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = ui.upgrade() {
                ui.set_frame(slint::Image::from_rgb8(buffer));
            }
        });
    })
}

/// Recognizer thread: loads the models, then turns each frame into letters.
fn recognize(frames: &LatestFrame, clear: &AtomicBool, ui: &slint::Weak<App>) {
    let started = Instant::now();
    let (detectors, models) = match (recognizer::Detectors::load(), recognizer::letter_models()) {
        (Ok(detectors), Ok(models)) => (detectors, models),
        (Err(error), _) => return log::error!("MediaPipe models: {error}"),
        (_, Err(error)) => return log::error!("Letter models: {error}"),
    };
    log::info!("Models loaded in {} ms", started.elapsed().as_millis());
    let mirror = camera::wanted_facing() == camera::LENS_FACING_FRONT;
    let mut recognizer = recognizer::Recognizer::new(detectors, &models);
    let mut rate = FrameRate::default();
    loop {
        let image = frames.take();
        if clear.swap(false, Ordering::Relaxed) {
            recognizer.clear();
        }
        let output = match recognizer.push(&image) {
            Ok(output) => output,
            Err(error) => {
                log::error!("Recognizer: {error}");
                continue;
            }
        };
        let (fps, second_passed) = rate.tick();
        let timings = output.timings;
        let stats = format!(
            "{fps:.1} cuadros/s · mano {:.0} ms · cara {:.0} ms · letras {:.1} ms",
            timings.hands, timings.face, timings.letters
        );
        if second_passed {
            log::info!("Detectar: {stats}");
        }
        let skeleton = skeleton_path(
            &output.hands,
            image.width as f32,
            image.height as f32,
            mirror,
        );
        let (width, height) = (image.width as i32, image.height as i32);
        let state = output.state;
        let ui = ui.clone();
        let _ = slint::invoke_from_event_loop(move || {
            let Some(ui) = ui.upgrade() else { return };
            ui.set_frame_width(width);
            ui.set_frame_height(height);
            ui.set_skeleton(skeleton.into());
            ui.set_text(state.text.concat().into());
            ui.set_moving(state.moving);
            let (letter, progress) = state
                .hypothesis
                .map_or((String::new(), 0.0), |h| (h.letter, h.progress as f32));
            ui.set_hypothesis(letter.into());
            ui.set_progress(progress);
            ui.set_status(
                if mirror {
                    "Cámara frontal"
                } else {
                    "Cámara trasera"
                }
                .into(),
            );
            ui.set_stats(stats.into());
        });
    }
}

/// Frames per second, averaged over about one second.
#[derive(Default)]
struct FrameRate {
    frames: u32,
    since: Option<Instant>,
    last: f32,
}

impl FrameRate {
    /// The current rate, and whether a new second just started.
    fn tick(&mut self) -> (f32, bool) {
        let since = *self.since.get_or_insert_with(Instant::now);
        self.frames += 1;
        let elapsed = since.elapsed().as_secs_f32();
        if elapsed < 1.0 {
            return (self.last, false);
        }
        self.last = self.frames as f32 / elapsed;
        self.frames = 0;
        self.since = Some(Instant::now());
        (self.last, true)
    }
}
