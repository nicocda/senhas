//! The senhas app, 100% Rust (ADR 0013): Slint for the UI, the NDK for the
//! camera, `hand-pipeline` for `MediaPipe`'s models and `senhas-core` for the letters.

slint::include_modules!();

#[cfg(target_os = "android")]
mod camera;
#[cfg(target_os = "android")]
mod permission;

/// The frame for the UI; `mirror` for the front camera, like a selfie. The image
/// itself stays as the camera sees it: that one goes to the models.
#[must_use]
pub fn display_buffer(
    image: &hand_pipeline::image::RgbImage,
    mirror: bool,
) -> slint::SharedPixelBuffer<slint::Rgb8Pixel> {
    let mut buffer =
        slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(image.width as u32, image.height as u32);
    let pixels = buffer.make_mut_bytes();
    if !mirror {
        pixels.copy_from_slice(&image.data);
        return buffer;
    }
    let row = image.width * 3;
    for (out, input) in pixels
        .chunks_exact_mut(row)
        .zip(image.data.chunks_exact(row))
    {
        let (out, _) = out.as_chunks_mut::<3>();
        let (input, _) = input.as_chunks::<3>();
        for (dst, src) in out.iter_mut().zip(input.iter().rev()) {
            *dst = *src;
        }
    }
    buffer
}

/// Whether the activity is on screen. The camera can only be opened in the
/// foreground (Android rejects it from the background), and it's closed when the
/// app leaves it, like the React Native app (`use-is-foreground.ts`).
#[cfg(target_os = "android")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Lifecycle {
    Foreground,
    Background,
}

#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
#[expect(
    clippy::no_mangle_with_rust_abi,
    reason = "android-activity calls android_main with the Rust ABI"
)]
fn android_main(app: slint::android::AndroidApp) {
    use slint::android::android_activity::{MainEvent, PollEvent};

    android_logger::init_once(
        android_logger::Config::default()
            .with_max_level(log::LevelFilter::Info)
            .with_tag("senhas"),
    );
    let (lifecycle, events) = std::sync::mpsc::channel();
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
    let weak = ui.as_weak();

    std::thread::spawn(move || {
        if let Err(error) = permission::wait_for_camera(&app) {
            log::error!("Camera permission: {error}");
            return;
        }
        run_camera(&events, &weak);
    });

    ui.run().expect("event loop");
}

/// Opens the camera while the app is in the foreground, closes it when it leaves.
#[cfg(target_os = "android")]
fn run_camera(events: &std::sync::mpsc::Receiver<Lifecycle>, ui: &slint::Weak<App>) {
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
        if camera.is_none() {
            let facing = camera::wanted_facing();
            match camera::Camera::open(facing, frame_handler(ui.clone(), facing)) {
                Ok(opened) => camera = Some(opened),
                Err(error) => log::error!("Camera: {error}"),
            }
        }
    }
}

/// Camera thread: shows each frame and, once per second, the frame rate.
#[cfg(target_os = "android")]
fn frame_handler(ui: slint::Weak<App>, facing: u8) -> camera::FrameCallback {
    use std::time::Instant;

    let mut frames = 0u32;
    let mut since = Instant::now();
    Box::new(move |image: hand_pipeline::image::RgbImage| {
        frames += 1;
        let elapsed = since.elapsed().as_secs_f32();
        let stats = (elapsed >= 1.0).then(|| {
            let text = format!(
                "{} × {} · {:.1} cuadros/s",
                image.width,
                image.height,
                frames as f32 / elapsed
            );
            log::info!("Camera: {text}");
            frames = 0;
            since = Instant::now();
            text
        });
        let buffer = display_buffer(&image, facing == 0);
        let ui = ui.clone();
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = ui.upgrade() {
                ui.set_frame(slint::Image::from_rgb8(buffer));
                ui.set_status(
                    if facing == 0 {
                        "Cámara frontal"
                    } else {
                        "Cámara trasera"
                    }
                    .into(),
                );
                if let Some(stats) = stats {
                    ui.set_stats(stats.into());
                }
            }
        });
    })
}
