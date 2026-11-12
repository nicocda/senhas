//! Parity with the TypeScript engine (ADR 0013), frame by frame, on every recorded
//! session. Needs `ml/runs/parity/ts.json`, written by `npm run dump:parity` in `app/`
//! (outside git: it comes from people's data). Without it the test is skipped.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use senhas_core::evaluation::interpret;
use senhas_core::features::two_hands;
use senhas_core::interpreter::InterpreterOptions;
use senhas_core::models::{Models, classify_hand};
use senhas_core::sequences::frame_vector;
use senhas_core::types::SessionExport;

/// Same tolerance as the TS vs .tflite check (ADR 0010).
const TOLERANCE: f64 = 1e-5;

#[derive(Deserialize)]
struct Dump {
    takes: Vec<TakeDump>,
}

#[derive(Deserialize)]
struct TakeDump {
    session: String,
    take: String,
    text: Vec<String>,
    frames: Vec<FrameDump>,
}

#[derive(Deserialize)]
struct FrameDump {
    prediction: Option<(String, f64)>,
    vector: Option<Vec<f64>>,
}

fn language() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ml/languages/aed")
}

#[test]
fn same_predictions_vectors_and_text_as_typescript() {
    let dump_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ml/runs/parity/ts.json");
    let Ok(dump) = fs::read_to_string(&dump_path) else {
        eprintln!(
            "Skipped: no {} (run `npm run dump:parity` in app/).",
            dump_path.display()
        );
        return;
    };
    let dump: Dump = serde_json::from_str(&dump).unwrap();
    let models = Models::load(&language().join("models")).unwrap();

    let mut sessions = Vec::new();
    for entry in fs::read_dir(language().join("data")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|ext| ext == "json") {
            let text = fs::read_to_string(path).unwrap();
            sessions.push(serde_json::from_str::<SessionExport>(&text).unwrap());
        }
    }

    let (mut frames, mut max_confidence, mut max_vector) = (0, 0f64, 0f64);
    for expected in &dump.takes {
        let data = sessions
            .iter()
            .find(|s| s.session.id == expected.session)
            .unwrap_or_else(|| panic!("session {} not found", expected.session));
        let take = data.takes.iter().find(|t| t.id == expected.take).unwrap();
        let hand = data.session.dominant_hand;
        let (width, height) = (
            take.image_width.unwrap_or(0.0),
            take.image_height.unwrap_or(0.0),
        );
        assert_eq!(take.frames.len(), expected.frames.len());

        for (i, (frame, want)) in take.frames.iter().zip(&expected.frames).enumerate() {
            let place = format!("{} frame {i}", expected.take);
            let (prediction, vector) = match frame.hands.len() {
                1 => (
                    classify_hand(
                        &models.static_letters,
                        &frame.hands[0],
                        &frame.body,
                        width,
                        height,
                    ),
                    frame_vector(&frame.hands[0], &frame.body, width, height),
                ),
                2 => (
                    two_hands(&frame.hands, width, height, hand)
                        .map(|input| models.two_hands.predict(&input)),
                    None,
                ),
                _ => (None, None),
            };
            match (&prediction, &want.prediction) {
                (Some(got), Some((label, confidence))) => {
                    assert_eq!(&got.label, label, "{place}");
                    let diff = (f64::from(got.confidence) - confidence).abs();
                    assert!(diff <= TOLERANCE, "{place}: confidence differs by {diff}");
                    max_confidence = max_confidence.max(diff);
                }
                (None, None) => {}
                _ => panic!("{place}: Rust {prediction:?}, TS {:?}", want.prediction),
            }
            match (&vector, &want.vector) {
                (Some(got), Some(want)) => {
                    for (a, b) in got.iter().zip(want) {
                        max_vector = max_vector.max((a - b).abs());
                    }
                }
                (None, None) => {}
                _ => panic!(
                    "{place}: frame vector Rust {vector:?}, TS {:?}",
                    want.vector
                ),
            }
            frames += 1;
        }

        let text = interpret(&models, take, hand, InterpreterOptions::default());
        assert_eq!(text, expected.text, "{}: interpreter text", expected.take);
    }
    assert!(
        max_vector <= TOLERANCE,
        "frame vectors differ by {max_vector}"
    );
    eprintln!(
        "{} takes, {frames} frames: max confidence diff {max_confidence:e}, max vector diff {max_vector:e}",
        dump.takes.len()
    );
}
