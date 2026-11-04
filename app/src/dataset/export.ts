import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { getSession, getTakes } from './db';
import type { RecordedFrame } from './types';

/** Bumped when the exported JSON changes shape; readers (Python, import) check it. */
// v2: imageWidth/imageHeight per take (null in takes recorded before).
export const EXPORT_FORMAT_VERSION = 2;

export interface SessionExport {
  format: 'senhas-session';
  formatVersion: number;
  exportedAt: number;
  session: {
    id: string;
    participant: string;
    dominantHand: 'left' | 'right';
    language: string;
    catalogSchema: number;
    consentAt: number;
    createdAt: number;
  };
  takes: {
    id: string;
    entryId: string;
    round: number;
    startedAt: number;
    imageWidth: number | null;
    imageHeight: number | null;
    frames: RecordedFrame[];
  }[];
}

/** Writes the session (without discarded takes) to a JSON file in the cache. */
export async function exportSession(sessionId: string): Promise<File> {
  const session = await getSession(sessionId);
  if (session == null) {
    throw new Error(`Session ${sessionId} not found.`);
  }
  const takes = await getTakes(sessionId);

  const payload: SessionExport = {
    format: 'senhas-session',
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    session: {
      id: session.id,
      participant: session.participant,
      dominantHand: session.dominant_hand,
      language: session.language,
      catalogSchema: session.catalog_schema,
      consentAt: session.consent_at,
      createdAt: session.created_at,
    },
    takes: takes.map((take) => ({
      id: take.id,
      entryId: take.entry_id,
      round: take.round,
      startedAt: take.started_at,
      imageWidth: take.image_width,
      imageHeight: take.image_height,
      frames: JSON.parse(take.frames) as RecordedFrame[],
    })),
  };

  const directory = new Directory(Paths.cache, 'exports');
  directory.create({ intermediates: true, idempotent: true });
  const date = new Date(session.created_at).toISOString().slice(0, 10);
  const file = new File(
    directory,
    `${session.language}-${session.participant}-${date}-${session.id.slice(0, 8)}.json`,
  );
  if (file.exists) {
    file.delete();
  }
  file.create();
  await file.write(JSON.stringify(payload));
  return file;
}

/** Opens Android's share sheet (Drive, email, Nearby Share...) for the exported file. */
export async function shareSession(sessionId: string): Promise<string> {
  const file = await exportSession(sessionId);
  await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Exportar sesión' });
  return file.uri;
}
