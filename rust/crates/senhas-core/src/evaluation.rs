//! Measures the interpretation engine on recorded sessions, same as
//! `app/scripts/evaluate-spelling.ts`: spellings (`spell:WORD` takes) against their
//! word, and single-letter takes against their letter.

use std::collections::{HashMap, HashSet};

use crate::catalog::Catalog;
use crate::interpreter::{Interpreter, InterpreterOptions};
use crate::models::Models;
use crate::types::{Hand, SessionExport, Take};

const PREFIX: &str = "spell:";

/// "LLAVE" -> L L A V E; "CHOCLO" -> CH O C L O.
#[must_use]
pub fn letters_of(word: &str) -> Vec<String> {
    let chars: Vec<char> = word.chars().collect();
    let mut letters = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        match (chars[i], chars.get(i + 1)) {
            ('C', Some('H')) => {
                letters.push("CH".to_owned());
                i += 2;
            }
            ('L', Some('L')) => {
                letters.extend(["L".to_owned(), "L".to_owned()]);
                i += 2;
            }
            (c, _) => {
                letters.push(c.to_string());
                i += 1;
            }
        }
    }
    letters
}

/// Levenshtein distance between two letter sequences.
#[must_use]
pub fn edit_distance(a: &[String], b: &[String]) -> usize {
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut current = vec![i + 1];
        for (j, y) in b.iter().enumerate() {
            let substitution = previous[j] + usize::from(x != y);
            current.push((previous[j + 1] + 1).min(current[j] + 1).min(substitution));
        }
        previous = current;
    }
    previous[b.len()]
}

/// The text the engine writes for a take.
#[must_use]
pub fn interpret(
    models: &Models,
    take: &Take,
    hand: Hand,
    options: InterpreterOptions,
) -> Vec<String> {
    let mut engine = Interpreter::new(models, hand, options);
    let mut text = Vec::new();
    for frame in &take.frames {
        text = engine.push(&take.live_frame(frame), frame.t).text;
    }
    text
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordResult {
    pub word: String,
    pub text: Vec<String>,
    pub errors: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionResult {
    pub participant: String,
    pub words: Vec<WordResult>,
    pub errors: usize,
    pub letters: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Evaluation {
    pub spelling: Vec<SessionResult>,
    /// Single-letter takes whose text is exactly their letter.
    pub single_exact: usize,
    pub single_total: usize,
    /// Single static-letter takes where a movement letter was written.
    pub false_movements: usize,
    pub static_takes: usize,
    /// Movement-letter takes where their letter was written.
    pub movement_found: usize,
    pub movement_takes: usize,
}

#[must_use]
pub fn evaluate(
    models: &Models,
    catalog: &Catalog,
    sessions: &[SessionExport],
    options: InterpreterOptions,
) -> Evaluation {
    let entries: HashMap<&str, _> = catalog.letters.iter().map(|e| (e.id.as_str(), e)).collect();
    let movement_letters: HashSet<&str> = catalog
        .letters
        .iter()
        .filter(|e| e.movement)
        .map(super::catalog::CatalogEntry::letter)
        .collect();
    let mut result = Evaluation::default();
    for data in sessions {
        let hand = data.session.dominant_hand;
        let mut session = SessionResult {
            participant: data.session.participant.clone(),
            words: Vec::new(),
            errors: 0,
            letters: 0,
        };
        for take in &data.takes {
            if let Some(word) = take.entry_id.strip_prefix(PREFIX) {
                let text = interpret(models, take, hand, options);
                let expected = letters_of(word);
                let errors = edit_distance(&text, &expected);
                session.errors += errors;
                session.letters += expected.len();
                session.words.push(WordResult {
                    word: word.to_owned(),
                    text,
                    errors,
                });
                continue;
            }
            // CH isn't recognized live (ADR 0010).
            let Some(entry) = entries.get(take.entry_id.as_str()).filter(|e| e.id != "CH") else {
                continue;
            };
            let text = interpret(models, take, hand, options);
            let letter = entry.letter();
            result.single_total += 1;
            if text.len() == 1 && text[0] == letter {
                result.single_exact += 1;
            }
            if entry.movement {
                result.movement_takes += 1;
                if text.iter().any(|item| item == letter) {
                    result.movement_found += 1;
                }
            } else if entry.hands == 1 {
                result.static_takes += 1;
                if text
                    .iter()
                    .any(|item| movement_letters.contains(item.as_str()))
                {
                    result.false_movements += 1;
                }
            }
        }
        if !session.words.is_empty() {
            result.spelling.push(session);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn letters(text: &str) -> Vec<String> {
        letters_of(text)
    }

    #[test]
    fn splits_ch_and_ll() {
        assert_eq!(letters("LLAVE"), ["L", "L", "A", "V", "E"]);
        assert_eq!(letters("CHOCLO"), ["CH", "O", "C", "L", "O"]);
        assert_eq!(letters("ÑANDU"), ["Ñ", "A", "N", "D", "U"]);
    }

    #[test]
    fn levenshtein() {
        assert_eq!(edit_distance(&letters("PERRO"), &letters("PERZO")), 1);
        assert_eq!(edit_distance(&letters("CR"), &letters("PERRO")), 4);
        assert_eq!(edit_distance(&[], &letters("TAZA")), 4);
    }
}
