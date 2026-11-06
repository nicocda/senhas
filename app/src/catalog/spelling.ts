// Words to spell in a recording session, from the language package (ADR 0006).
import raw from '../../../ml/languages/aed/spelling.json';

import { type CatalogEntry, catalog, letterOf } from './catalog';

/**
 * Spelling takes are saved like letter takes, with this prefix + the word as the
 * entry id ("spell:CASA"). Training only reads catalog ids, so it ignores them.
 */
export const SPELLING_PREFIX = 'spell:';

const SUPPORTED_SCHEMA_VERSION = 1;

/** One entry per letter (V: its first variant, for the color and hands). */
const byLetter = new Map<string, CatalogEntry>();
for (const entry of catalog.letters) {
  if (!byLetter.has(letterOf(entry))) {
    byLetter.set(letterOf(entry), entry);
  }
}
/** Longest first, so "CH" is read before "C". */
const letters = [...byLetter.keys()].sort((a, b) => b.length - a.length);

/** "CASA" -> the catalog entries of C, A, S, A. Throws on a letter not in the catalog. */
export function spell(word: string): CatalogEntry[] {
  const result: CatalogEntry[] = [];
  let rest = word.toUpperCase();
  while (rest.length > 0) {
    const letter = letters.find((candidate) => rest.startsWith(candidate));
    const entry = letter == null ? undefined : byLetter.get(letter);
    if (letter == null || entry == null) {
      throw new Error(`"${word}": "${rest[0]}" is not in the catalog.`);
    }
    result.push(entry);
    rest = rest.slice(letter.length);
  }
  return result;
}

function load(): string[] {
  const file = raw as { schemaVersion: number; words: string[] };
  if (file.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `spelling.json schemaVersion ${file.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }
  // Fails at startup, not mid-session, if a word has a letter the catalog lacks.
  file.words.forEach(spell);
  return file.words;
}

export const spellingWords = load();
