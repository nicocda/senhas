//! The letter catalog of a language package (`ml/languages/<code>/letters.json`),
//! same as `app/src/catalog/catalog.ts`. Only the fields recognition needs.

use serde::Deserialize;

use crate::Error;

const SUPPORTED_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogEntry {
    pub id: String,
    pub letter: Option<String>,
    pub level: u32,
    pub hands: u8,
    pub movement: bool,
}

impl CatalogEntry {
    /// What to show (V for V1 and V2).
    #[must_use]
    pub fn letter(&self) -> &str {
        self.letter.as_deref().unwrap_or(&self.id)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub letters: Vec<CatalogEntry>,
}

impl Catalog {
    pub fn from_json(json: &str) -> Result<Self, Error> {
        let catalog: Self = serde_json::from_str(json)?;
        if catalog.schema_version != SUPPORTED_SCHEMA_VERSION {
            return Err(Error::Version(format!(
                "Catalog schemaVersion {} is not supported (expected {SUPPORTED_SCHEMA_VERSION}).",
                catalog.schema_version
            )));
        }
        Ok(catalog)
    }
}
