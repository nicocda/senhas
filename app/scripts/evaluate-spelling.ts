/**
 * Measures the live interpretation engine on recorded spellings (Hito 5): every
 * spelling take ("spell:WORD") goes frame by frame through the same LiveRecognizer
 * that Detectar uses, and the text it produces is compared with the word.
 *
 *   npm run evaluate:spelling                 (every session in ml/languages/aed/data)
 *   npm run evaluate:spelling -- <file.json>  (some sessions; PowerShell: see CLAUDE.md)
 *
 * Letter error = edit distance (insertions, deletions, substitutions) / letters in
 * the word, like the character error rate used for speech recognition.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionExport } from '@/dataset/export';
import { LiveRecognizer } from '@/recognition/live';
import { classifierFor, movementRecognizerFor } from '@/recognition/models';

const DATA_DIR = join(import.meta.dirname, '../../ml/languages/aed/data');
const PREFIX = 'spell:';

/** "LLAVE" -> L L A V E; "CHOCLO" -> CH O C L O. */
function lettersOf(word: string): string[] {
  return (word.match(/CH|LL|./gu) ?? []).flatMap((part) => (part === 'LL' ? ['L', 'L'] : [part]));
}

/** Levenshtein distance between two letter sequences. */
export function editDistance(a: string[], b: string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current.push(
        Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

const files = process.argv.slice(2);
const names =
  files.length > 0 ? files : readdirSync(DATA_DIR).filter((name) => name.endsWith('.json'));

// The engine logs every DTW attempt to the in-app debug panel; here it's noise.
console.log = () => {};
const print = (text: string) => process.stdout.write(text + '\n');

let allErrors = 0;
let allLetters = 0;
for (const name of names) {
  const data = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as SessionExport;
  const takes = data.takes.filter((take) => take.entryId.startsWith(PREFIX));
  if (takes.length === 0) {
    continue;
  }
  print(`\n${data.session.participant} (${name})`);
  let errors = 0;
  let letters = 0;
  for (const take of takes) {
    const word = take.entryId.slice(PREFIX.length);
    const engine = new LiveRecognizer(
      classifierFor('static'),
      classifierFor(4),
      movementRecognizerFor(),
      data.session.dominantHand,
    );
    // What the screen would show, as text: each new letter that appears (a letter
    // that stays, or comes back after "not sure", is written once).
    const text: string[] = [];
    for (const frame of take.frames) {
      const result = engine.push(
        {
          hands: frame.hands,
          body: frame.body,
          imageWidth: take.imageWidth ?? 0,
          imageHeight: take.imageHeight ?? 0,
        },
        frame.t,
      );
      if (result != null && text.at(-1) !== result.letter) {
        text.push(result.letter);
      }
    }
    const expected = lettersOf(word);
    const distance = editDistance(text, expected);
    errors += distance;
    letters += expected.length;
    print(`  ${word.padEnd(8)} → ${(text.join('') || '—').padEnd(10)} ${distance} errores`);
  }
  print(`  Error por letra: ${errors}/${letters} = ${Math.round((errors / letters) * 100)}%`);
  allErrors += errors;
  allLetters += letters;
}
if (allLetters === 0) {
  print('No hay tomas de deletreo.');
} else {
  print(`\nTotal: ${allErrors}/${allLetters} = ${Math.round((allErrors / allLetters) * 100)}%`);
}
