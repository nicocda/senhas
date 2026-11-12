/**
 * Writes what the TypeScript engine computes for every recorded frame, so the Rust
 * port (rust/crates/senhas-core, ADR 0013) can check it gets the same numbers:
 *
 *   npm run dump:parity   ->   ml/runs/parity/ts.json (outside git: comes from people's data)
 *
 * Per frame: the static or two-hands prediction (label, confidence) and the
 * movement frame vector; per take: the text the interpreter writes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { twoHands } from '@/dataset/features';
import { classifierFor, classifyHand } from '@/recognition/models';
import { frameVector } from '@/recognition/sequences';

import { evaluate, interpret, loadSessions } from './evaluate-spelling';

const OUT_DIR = join(import.meta.dirname, '../../ml/runs/parity');

interface FrameDump {
  prediction: [string, number] | null;
  vector: number[] | null;
}

interface TakeDump {
  session: string;
  take: string;
  text: string[];
  frames: FrameDump[];
}

const sessions = loadSessions();
const staticClassifier = classifierFor('static');
const twoHandsClassifier = classifierFor(4);
const takes: TakeDump[] = [];

for (const data of sessions) {
  const hand = data.session.dominantHand;
  for (const take of data.takes) {
    const width = take.imageWidth ?? 0;
    const height = take.imageHeight ?? 0;
    const frames = take.frames.map((frame): FrameDump => {
      let prediction = null;
      let vector = null;
      if (frame.hands.length === 1) {
        prediction = classifyHand(staticClassifier, frame.hands[0], frame.body, width, height);
        vector = frameVector(frame.hands[0], frame.body, width, height);
      } else if (frame.hands.length === 2) {
        const input = twoHands(frame.hands, width, height, hand);
        prediction = input == null ? null : twoHandsClassifier.predict(input);
      }
      return {
        prediction: prediction == null ? null : [prediction.label, prediction.confidence],
        vector,
      };
    });
    takes.push({
      session: data.session.id,
      take: take.id,
      text: interpret(take, hand),
      frames,
    });
  }
}

// The engine alone, every session, to compare with the Rust evaluator's "Motor" time.
const print = console.log;
console.log = () => {};
const runs = 5;
const started = performance.now();
for (let i = 0; i < runs; i++) {
  evaluate(sessions);
}
const engineMs = (performance.now() - started) / runs;
console.log = print;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'ts.json'), JSON.stringify({ engineMs, takes }));
const frameCount = takes.reduce((sum, take) => sum + take.frames.length, 0);
print(`${takes.length} tomas, ${frameCount} cuadros → ml/runs/parity/ts.json`);
print(`Motor (evaluate, promedio de ${runs}): ${engineMs.toFixed(1)} ms`);
