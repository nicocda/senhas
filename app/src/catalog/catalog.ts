// The catalog lives in ml/ so the app and the Python training read the same file
// (ADR 0006). Metro resolves files outside the project root since Expo SDK 56.
import plan from '../../../ml/languages/aed/capture-plan.json';
import aed from '../../../ml/languages/aed/letters.json';

export type Location = 'neutral' | 'face' | 'body';

/** One class of the model: a letter, or one variant of a letter (V1, V2). */
export interface CatalogEntry {
  id: string;
  /** The letter this entry represents. Missing: the entry's own id. */
  letter?: string;
  level: number;
  hands: 1 | 2;
  movement: boolean;
  location: Location;
  color: string;
  verified: boolean;
  sameHandshapeAs?: string;
  confusableWith?: string[];
  note?: string;
}

export interface Catalog {
  schemaVersion: number;
  language: { code: string; name: string };
  levels: { id: number; name: string }[];
  letters: CatalogEntry[];
}

const SUPPORTED_SCHEMA_VERSION = 1;

function load(raw: unknown): Catalog {
  const catalog = raw as Catalog;
  if (catalog.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Catalog schemaVersion ${catalog.schemaVersion} is not supported (expected ${SUPPORTED_SCHEMA_VERSION}).`,
    );
  }
  return catalog;
}

export const catalog = load(aed);

interface CapturePlan {
  schemaVersion: number;
  levels: Record<string, { extraRounds: Record<string, number> } | undefined>;
}

const capturePlan = plan as CapturePlan;

/**
 * Extra capture rounds for a letter, written by ml/train.py from how often the last
 * model got it wrong: hard letters get recorded more.
 */
export function extraRounds(entry: CatalogEntry): number {
  return capturePlan.levels[String(entry.level)]?.extraRounds[entry.id] ?? 0;
}

export function entriesForLevel(level: number): CatalogEntry[] {
  return catalog.letters.filter((entry) => entry.level === level);
}

export function letterOf(entry: CatalogEntry): string {
  return entry.letter ?? entry.id;
}
