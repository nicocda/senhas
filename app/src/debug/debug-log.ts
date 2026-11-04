import { useSyncExternalStore } from 'react';

/**
 * In-app debug log: the last events of this run, in memory only (nothing is
 * written to disk). Shown by <DebugPanel /> when debug mode is on.
 */

export type DebugLevel = 'info' | 'warn' | 'error';

export interface DebugEntry {
  id: number;
  time: number;
  level: DebugLevel;
  message: string;
}

const MAX_ENTRIES = 200;

interface DebugState {
  enabled: boolean;
  entries: DebugEntry[];
}

let state: DebugState = { enabled: false, entries: [] };
let nextId = 0;
const listeners = new Set<() => void>();

function update(next: DebugState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function debugLog(message: string, level: DebugLevel = 'info') {
  const entry: DebugEntry = { id: nextId++, time: Date.now(), level, message };
  update({ ...state, entries: [...state.entries, entry].slice(-MAX_ENTRIES) });
  // console.log for every level: console.warn/error open React Native's LogBox
  // over the screen, which gets in the way while recording. The panel shows the level.
  console.log(`[${level}] ${message}`);
}

export function toggleDebugMode() {
  update({ ...state, enabled: !state.enabled });
}

export function clearDebugLog() {
  update({ ...state, entries: [] });
}

export function useDebugState(): DebugState {
  return useSyncExternalStore(subscribe, () => state);
}
