//! Recognition logic of senhas, ported from the React Native app (ADR 0013):
//! the same normalization, classifiers, DTW and interpretation engine, so both apps
//! write the same text for the same frames.

pub mod catalog;
pub mod classifier;
pub mod evaluation;
pub mod features;
pub mod interpreter;
pub mod models;
pub mod sequences;
pub mod smoothing;
pub mod types;

use std::fmt;

#[derive(Debug)]
pub enum Error {
    Io(std::io::Error),
    Json(serde_json::Error),
    /// A model, catalog or session made for another version of the normalization.
    Version(String),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Json(error) => write!(f, "invalid JSON: {error}"),
            Self::Version(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}
