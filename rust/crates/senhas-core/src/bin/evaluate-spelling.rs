//! Same report as `npm run evaluate:spelling` (app/scripts/evaluate-spelling.ts).
//!
//!   cargo run --release --bin evaluate-spelling                  (every session)
//!   cargo run --release --bin evaluate-spelling -- <file.json>   (some sessions)

use std::path::{Path, PathBuf};
use std::time::Instant;
use std::{env, fs};

use senhas_core::catalog::Catalog;
use senhas_core::evaluation::evaluate;
use senhas_core::interpreter::InterpreterOptions;
use senhas_core::models::Models;
use senhas_core::types::SessionExport;

fn language_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../ml/languages/aed")
}

fn percent(part: usize, total: usize) -> String {
    let value = (part as f64 / total.max(1) as f64 * 100.0).round();
    format!("{part}/{total} = {value}%")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let language = language_dir();
    let models = Models::load(&language.join("models"))?;
    let catalog = Catalog::from_json(&fs::read_to_string(language.join("letters.json"))?)?;

    let data = language.join("data");
    let mut files: Vec<PathBuf> = env::args().skip(1).map(PathBuf::from).collect();
    if files.is_empty() {
        let mut names: Vec<_> = fs::read_dir(&data)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
            .collect();
        names.sort();
        files = names;
    } else {
        files = files.into_iter().map(|name| data.join(name)).collect();
    }
    let sessions = files
        .iter()
        .map(|path| {
            Ok(serde_json::from_str::<SessionExport>(&fs::read_to_string(
                path,
            )?)?)
        })
        .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;

    let started = Instant::now();
    let result = evaluate(&models, &catalog, &sessions, InterpreterOptions::default());
    let elapsed = started.elapsed();

    let (mut errors, mut letters) = (0, 0);
    for session in &result.spelling {
        println!("\n{}", session.participant);
        for word in &session.words {
            let text = word.text.concat();
            let text = if text.is_empty() {
                "—".to_owned()
            } else {
                text
            };
            println!("  {:<8} → {:<10} {} errores", word.word, text, word.errors);
        }
        println!(
            "  Error por letra: {}",
            percent(session.errors, session.letters)
        );
        errors += session.errors;
        letters += session.letters;
    }
    println!("\nDeletreo, error por letra: {}", percent(errors, letters));
    println!(
        "Letras sueltas exactas: {}",
        percent(result.single_exact, result.single_total)
    );
    println!(
        "Letras quietas que escriben una con movimiento: {}",
        percent(result.false_movements, result.static_takes)
    );
    println!(
        "Letras con movimiento encontradas: {}",
        percent(result.movement_found, result.movement_takes)
    );
    eprintln!("\nMotor: {:.1} ms", elapsed.as_secs_f64() * 1000.0);
    Ok(())
}
