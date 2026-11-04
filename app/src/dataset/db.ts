import { randomUUID } from 'expo-crypto';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { RecordedFrame } from './types';

/**
 * Local dataset: sessions (one person, one sitting) and takes (one letter, one round).
 * Only hand coordinates are stored, never images. Stays in the app's private storage.
 */

const SCHEMA_VERSION = 1;

let database: Promise<SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLiteDatabase> {
  database ??= open();
  return database;
}

async function open(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync('dataset.db');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema ${version} is newer than this app (${SCHEMA_VERSION}).`);
  }
  if (version < 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY NOT NULL,
          participant TEXT NOT NULL,
          dominant_hand TEXT NOT NULL CHECK (dominant_hand IN ('left', 'right')),
          language TEXT NOT NULL,
          catalog_schema INTEGER NOT NULL,
          consent_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE takes (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
          entry_id TEXT NOT NULL,
          round INTEGER NOT NULL,
          started_at INTEGER NOT NULL,
          frames TEXT NOT NULL,
          discarded INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX takes_session ON takes (session_id);
        PRAGMA user_version = 1;
      `);
    });
  }
  return db;
}

export interface SessionInput {
  participant: string;
  dominantHand: 'left' | 'right';
  language: string;
  catalogSchema: number;
  consentAt: number;
}

export async function createSession(input: SessionInput): Promise<string> {
  const db = await getDatabase();
  const id = randomUUID();
  await db.runAsync(
    `INSERT INTO sessions (id, participant, dominant_hand, language, catalog_schema, consent_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.participant,
    input.dominantHand,
    input.language,
    input.catalogSchema,
    input.consentAt,
    Date.now(),
  );
  return id;
}

export interface TakeInput {
  sessionId: string;
  entryId: string;
  round: number;
  startedAt: number;
  frames: RecordedFrame[];
}

export async function saveTake(input: TakeInput): Promise<string> {
  const db = await getDatabase();
  const id = randomUUID();
  await db.runAsync(
    `INSERT INTO takes (id, session_id, entry_id, round, started_at, frames) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.sessionId,
    input.entryId,
    input.round,
    input.startedAt,
    JSON.stringify(input.frames),
  );
  return id;
}

/** A take the person did wrong: kept out of the export, but not deleted. */
export async function discardTake(takeId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE takes SET discarded = 1 WHERE id = ?', takeId);
}

export interface SessionRow {
  id: string;
  participant: string;
  dominant_hand: 'left' | 'right';
  language: string;
  catalog_schema: number;
  consent_at: number;
  created_at: number;
}

export interface TakeRow {
  id: string;
  entry_id: string;
  round: number;
  started_at: number;
  frames: string;
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const db = await getDatabase();
  return db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ?', sessionId);
}

export async function getTakes(sessionId: string): Promise<TakeRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<TakeRow>(
    `SELECT id, entry_id, round, started_at, frames FROM takes
     WHERE session_id = ? AND discarded = 0 ORDER BY started_at`,
    sessionId,
  );
}
