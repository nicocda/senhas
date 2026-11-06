/**
 * Measures the interpretation engine (src/recognition/interpreter.ts) on recorded
 * data, frame by frame, exactly as Detectar runs it:
 *
 * - spellings ("spell:WORD" takes): the text written vs the word;
 * - single letters (the takes recorded by level): the text should be just that
 *   letter. Optimistic for static letters (the classifier was trained on them),
 *   but it shows whether held letters write movement letters.
 *
 *   npm run evaluate:spelling                 (every session in ml/languages/aed/data)
 *   npm run evaluate:spelling -- <file.json>  (some sessions)
 *
 * Letter error = edit distance (insertions, deletions, substitutions) / letters in
 * the word, like the character error rate used for speech recognition.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { catalog, letterOf } from '@/catalog/catalog';
import type { SessionExport } from '@/dataset/export';
import { Interpreter, type InterpreterOptions } from '@/recognition/interpreter';
import { classifierFor, movementRecognizerFor } from '@/recognition/models';

const DATA_DIR = join(import.meta.dirname, '../../ml/languages/aed/data');
const PREFIX = 'spell:';

/** "LLAVE" -> L L A V E; "CHOCLO" -> CH O C L O. */
export function lettersOf(word: string): string[] {
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

type Take = SessionExport['takes'][number];

/** The text the engine writes for a take. */
export function interpret(
  take: Take,
  dominantHand: 'left' | 'right',
  options: Partial<InterpreterOptions> = {},
): string[] {
  const engine = new Interpreter(
    classifierFor('static'),
    classifierFor(4),
    movementRecognizerFor(),
    dominantHand,
    () => {},
    options,
  );
  let text: string[] = [];
  for (const frame of take.frames) {
    text = engine.push(
      {
        hands: frame.hands,
        body: frame.body,
        imageWidth: take.imageWidth ?? 0,
        imageHeight: take.imageHeight ?? 0,
      },
      frame.t,
    ).text;
  }
  return text;
}

export interface SessionResult {
  participant: string;
  words: { word: string; text: string[]; errors: number }[];
  errors: number;
  letters: number;
}

export interface Evaluation {
  spelling: SessionResult[];
  /** Single-letter takes whose text is exactly their letter. */
  singleExact: number;
  singleTotal: number;
  /** Single static-letter takes where a movement letter was written. */
  falseMovements: number;
  staticTakes: number;
  /** Movement-letter takes where their letter was written. */
  movementFound: number;
  movementTakes: number;
}

export function loadSessions(names?: string[]): SessionExport[] {
  const files =
    names != null && names.length > 0
      ? names
      : readdirSync(DATA_DIR).filter((name) => name.endsWith('.json'));
  return files.map(
    (name) => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as SessionExport,
  );
}

export function evaluate(
  sessions: SessionExport[],
  options: Partial<InterpreterOptions> = {},
): Evaluation {
  const entries = new Map(catalog.letters.map((entry) => [entry.id, entry]));
  const movementLetters = new Set(catalog.letters.filter((entry) => entry.movement).map(letterOf));
  const result: Evaluation = {
    spelling: [],
    singleExact: 0,
    singleTotal: 0,
    falseMovements: 0,
    staticTakes: 0,
    movementFound: 0,
    movementTakes: 0,
  };
  for (const data of sessions) {
    const hand = data.session.dominantHand;
    const session: SessionResult = {
      participant: data.session.participant,
      words: [],
      errors: 0,
      letters: 0,
    };
    for (const take of data.takes) {
      if (take.entryId.startsWith(PREFIX)) {
        const word = take.entryId.slice(PREFIX.length);
        const text = interpret(take, hand, options);
        const expected = lettersOf(word);
        const errors = editDistance(text, expected);
        session.words.push({ word, text, errors });
        session.errors += errors;
        session.letters += expected.length;
        continue;
      }
      const entry = entries.get(take.entryId);
      // CH isn't recognized live (ADR 0010).
      if (entry == null || entry.id === 'CH') {
        continue;
      }
      const text = interpret(take, hand, options);
      const letter = letterOf(entry);
      result.singleTotal++;
      if (text.length === 1 && text[0] === letter) {
        result.singleExact++;
      }
      if (entry.movement) {
        result.movementTakes++;
        if (text.includes(letter)) {
          result.movementFound++;
        }
      } else if (entry.hands === 1) {
        result.staticTakes++;
        if (text.some((item) => movementLetters.has(item))) {
          result.falseMovements++;
        }
      }
    }
    if (session.words.length > 0) {
      result.spelling.push(session);
    }
  }
  return result;
}

const percent = (part: number, total: number) =>
  `${part}/${total} = ${Math.round((part / Math.max(total, 1)) * 100)}%`;

if (import.meta.main) {
  // The engine logs to the in-app debug panel through console.log; here it's noise.
  const print = console.log;
  console.log = () => {};
  const result = evaluate(loadSessions(process.argv.slice(2)));
  let errors = 0;
  let letters = 0;
  for (const session of result.spelling) {
    print(`\n${session.participant}`);
    for (const { word, text, errors: wordErrors } of session.words) {
      print(`  ${word.padEnd(8)} → ${(text.join('') || '—').padEnd(10)} ${wordErrors} errores`);
    }
    print(`  Error por letra: ${percent(session.errors, session.letters)}`);
    errors += session.errors;
    letters += session.letters;
  }
  print(`\nDeletreo, error por letra: ${percent(errors, letters)}`);
  print(`Letras sueltas exactas: ${percent(result.singleExact, result.singleTotal)}`);
  print(
    `Letras quietas que escriben una con movimiento: ${percent(result.falseMovements, result.staticTakes)}`,
  );
  print(
    `Letras con movimiento encontradas: ${percent(result.movementFound, result.movementTakes)}`,
  );
}
