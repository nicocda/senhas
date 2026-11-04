import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { clearDebugLog, useDebugState } from './debug-log';

function formatTime(time: number): string {
  return new Date(time).toTimeString().slice(0, 8);
}

/** Floating log over every screen, only while debug mode is on. */
export function DebugPanel() {
  const { enabled, entries } = useDebugState();
  const [expanded, setExpanded] = useState(true);

  if (!enabled) {
    return null;
  }

  return (
    <View style={[styles.panel, !expanded && styles.collapsed]} pointerEvents="box-none">
      <View style={styles.header}>
        <Text style={styles.title}>Debug ({entries.length})</Text>
        <Pressable onPress={clearDebugLog} hitSlop={8}>
          <Text style={styles.action}>Limpiar</Text>
        </Pressable>
        <Pressable onPress={() => setExpanded(!expanded)} hitSlop={8}>
          <Text style={styles.action}>{expanded ? 'Ocultar' : 'Ver'}</Text>
        </Pressable>
      </View>
      {expanded && (
        <ScrollView style={styles.list}>
          {[...entries].reverse().map((entry) => (
            <Text
              key={entry.id}
              style={[
                styles.entry,
                entry.level === 'warn' && styles.warn,
                entry.level === 'error' && styles.error,
              ]}>
              {formatTime(entry.time)} {entry.message}
            </Text>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 120,
    maxHeight: 260,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 8,
    padding: 8,
  },
  collapsed: {
    left: undefined,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  title: {
    color: 'white',
    fontWeight: '700',
  },
  action: {
    color: '#7CC4FF',
    fontWeight: '600',
  },
  list: {
    marginTop: 4,
  },
  entry: {
    color: 'white',
    fontFamily: 'monospace',
    fontSize: 11,
  },
  warn: {
    color: '#FFD54F',
  },
  error: {
    color: '#FF8A80',
  },
});
