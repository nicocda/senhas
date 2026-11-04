import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { useHandTracking } from '@/camera/use-hand-tracking';
import { type CatalogEntry, catalog, entriesForLevel, letterOf } from '@/catalog/catalog';
import { Button } from '@/components/button';
import { createSession, discardTake, saveTake } from '@/dataset/db';
import { shareSession } from '@/dataset/export';

const ROUNDS = 3;
const PREPARE_MS = 1500;
const RECORD_MS = 2000;
const RECORD_MOVEMENT_MS = 3000;
/** Below this many frames with the hand, a letter needs more takes. */
const MIN_VALID_FRAMES = 20;

interface QueueItem {
  entry: CatalogEntry;
  round: number;
}

interface SessionSetup {
  sessionId: string;
  queue: QueueItem[];
}

export default function CaptureScreen() {
  const params = useLocalSearchParams<{ level: string }>();
  const level = Number(params.level);
  const entries = entriesForLevel(level);
  const [setup, setSetup] = useState<SessionSetup | null>(null);

  if (entries.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>El nivel {params.level} no tiene letras.</Text>
      </View>
    );
  }

  if (setup == null) {
    return <SetupForm level={level} entries={entries} onStart={setSetup} />;
  }

  return (
    <CameraPermissionGate>
      <CaptureRun sessionId={setup.sessionId} initialQueue={setup.queue} />
    </CameraPermissionGate>
  );
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function SetupForm({
  level,
  entries,
  onStart,
}: {
  level: number;
  entries: CatalogEntry[];
  onStart: (setup: SessionSetup) => void;
}) {
  const [participant, setParticipant] = useState('P01');
  const [dominantHand, setDominantHand] = useState<'left' | 'right'>('right');
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const levelName = catalog.levels.find((l) => l.id === level)?.name ?? '';

  const start = async () => {
    setStarting(true);
    try {
      const sessionId = await createSession({
        participant: participant.trim(),
        dominantHand,
        language: catalog.language.code,
        catalogSchema: catalog.schemaVersion,
        consentAt: Date.now(),
      });
      const queue: QueueItem[] = [];
      for (let round = 1; round <= ROUNDS; round++) {
        queue.push(...shuffle(entries).map((entry) => ({ entry, round })));
      }
      onStart({ sessionId, queue });
    } catch (error) {
      setStarting(false);
      Alert.alert('No se pudo crear la sesión', String(error));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.title}>
        Nivel {level}: {levelName}
      </Text>
      <Text style={styles.message}>
        {entries.length} letras × {ROUNDS} rondas en orden aleatorio, unos{' '}
        {Math.ceil((entries.length * ROUNDS * (PREPARE_MS + RECORD_MS)) / 60000)} minutos.
      </Text>

      <Text style={styles.label}>Código de la persona (sin nombre)</Text>
      <TextInput
        style={styles.input}
        value={participant}
        onChangeText={setParticipant}
        autoCapitalize="characters"
        autoCorrect={false}
      />

      <Text style={styles.label}>Mano dominante</Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Choice
            label="Derecha"
            selected={dominantHand === 'right'}
            onPress={() => setDominantHand('right')}
          />
        </View>
        <View style={styles.flex}>
          <Choice
            label="Izquierda"
            selected={dominantHand === 'left'}
            onPress={() => setDominantHand('left')}
          />
        </View>
      </View>

      <Pressable
        style={styles.consent}
        onPress={() => setConsent(!consent)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consent }}>
        <Text style={styles.checkbox}>{consent ? '☑' : '☐'}</Text>
        <Text style={styles.consentText}>
          Acepto que se guarden las coordenadas de mi mano (nunca imágenes ni video) en este
          teléfono, para entrenar un modelo que reconozca la LSA. Puedo pedir que se borren.
        </Text>
      </Pressable>

      <Button
        label={starting ? 'Preparando…' : 'Empezar'}
        onPress={start}
        disabled={!consent || participant.trim() === '' || starting}
      />
    </ScrollView>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

type Phase = 'prepare' | 'record' | 'done';

interface LastTake {
  id: string;
  item: QueueItem;
  validFrames: number;
}

function CaptureRun({ sessionId, initialQueue }: { sessionId: string; initialQueue: QueueItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('prepare');
  const [lastTake, setLastTake] = useState<LastTake | null>(null);
  const [validFrames, setValidFrames] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const recordStartedAt = useRef(0);

  const current = phase === 'done' ? null : queue[index];
  const { frameOutput, landmarks, imageSize, startRecording, stopRecording } = useHandTracking({
    numHands: current?.entry.hands ?? 1,
  });

  useEffect(() => {
    if (current == null) {
      return;
    }
    if (phase === 'prepare') {
      const timer = setTimeout(() => {
        recordStartedAt.current = Date.now();
        startRecording();
        setPhase('record');
      }, PREPARE_MS);
      return () => clearTimeout(timer);
    }

    const duration = current.entry.movement ? RECORD_MOVEMENT_MS : RECORD_MS;
    // Set by the cleanup: after saving, don't move the run forward if the screen
    // was left or the take was repeated in the meantime.
    let cancelled = false;
    const timer = setTimeout(async () => {
      const frames = stopRecording();
      const valid = frames.filter((frame) => frame.hands.length >= current.entry.hands).length;
      try {
        const id = await saveTake({
          sessionId,
          entryId: current.entry.id,
          round: current.round,
          startedAt: recordStartedAt.current,
          frames,
        });
        if (cancelled) {
          return;
        }
        setLastTake({ id, item: current, validFrames: valid });
        setValidFrames((counts) => ({
          ...counts,
          [current.entry.id]: (counts[current.entry.id] ?? 0) + valid,
        }));
      } catch (error) {
        Alert.alert('No se pudo guardar la toma', String(error));
      }
      if (cancelled) {
        return;
      }
      if (index + 1 < queue.length) {
        setIndex(index + 1);
        setPhase('prepare');
      } else {
        setPhase('done');
      }
    }, duration);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Leaving mid-take (repeat, back button): the frames are dropped.
      stopRecording();
    };
  }, [phase, index, current, queue, sessionId, startRecording, stopRecording]);

  /** Discards the previous take and puts its letter next in line. */
  const repeatLast = async () => {
    if (lastTake == null) {
      return;
    }
    const { id, item, validFrames: valid } = lastTake;
    setLastTake(null);
    try {
      await discardTake(id);
    } catch (error) {
      Alert.alert('No se pudo descartar la toma', String(error));
      return;
    }
    setValidFrames((counts) => ({
      ...counts,
      [item.entry.id]: (counts[item.entry.id] ?? 0) - valid,
    }));
    const insertAt = phase === 'done' ? queue.length : index;
    setQueue([...queue.slice(0, insertAt), item, ...queue.slice(insertAt)]);
    setIndex(insertAt);
    setPhase('prepare');
  };

  const exportSession = async () => {
    setExporting(true);
    try {
      await shareSession(sessionId);
    } catch (error) {
      Alert.alert('No se pudo exportar', String(error));
    } finally {
      setExporting(false);
    }
  };

  if (phase === 'done' || current == null) {
    const entries = [...new Map(queue.map((item) => [item.entry.id, item.entry])).values()];
    return (
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>¡Listo!</Text>
        <Text style={styles.message}>Cuadros con la mano detectada, por letra:</Text>
        {entries.map((entry) => {
          const count = validFrames[entry.id] ?? 0;
          return (
            <View key={entry.id} style={styles.summaryRow}>
              <Text style={[styles.summaryLetter, { color: entry.color }]}>{letterOf(entry)}</Text>
              <Text style={styles.summaryId}>{entry.id !== letterOf(entry) ? entry.id : ''}</Text>
              <Text style={[styles.summaryCount, count < MIN_VALID_FRAMES && styles.warning]}>
                {count}
                {count < MIN_VALID_FRAMES ? '  (pocas)' : ''}
              </Text>
            </View>
          );
        })}
        {lastTake != null && <Button label="Repetir la última" onPress={repeatLast} />}
        <Button
          label={exporting ? 'Exportando…' : 'Exportar sesión'}
          onPress={exportSession}
          disabled={exporting}
        />
        <Button label="Volver al menú" onPress={() => router.back()} />
      </ScrollView>
    );
  }

  const recording = phase === 'record';
  return (
    <View style={styles.fill}>
      <HandCamera frameOutput={frameOutput} landmarks={landmarks} imageSize={imageSize} />
      <View style={styles.topBar}>
        <Text style={styles.progress}>
          Ronda {current.round}/{ROUNDS} · {index + 1}/{queue.length}
        </Text>
        <View style={[styles.letterBadge, { backgroundColor: current.entry.color }]}>
          <Text style={styles.letter}>{letterOf(current.entry)}</Text>
        </View>
        {current.entry.id !== letterOf(current.entry) && (
          <Text style={styles.variant}>Variante {current.entry.id}</Text>
        )}
        <Text style={[styles.status, recording && styles.statusRecording]}>
          {recording ? '● Grabando' : 'Preparate…'}
        </Text>
      </View>
      {lastTake != null && (
        <View style={styles.bottomBar}>
          <Button label={`Repetir ${letterOf(lastTake.item.entry)}`} onPress={repeatLast} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  form: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  message: {
    fontSize: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    borderColor: '#9AA5B1',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  choice: {
    alignItems: 'center',
    borderColor: '#208AEF',
    borderRadius: 8,
    borderWidth: 2,
    paddingVertical: 10,
  },
  choiceSelected: {
    backgroundColor: '#208AEF',
  },
  choiceLabel: {
    color: '#208AEF',
    fontSize: 16,
    fontWeight: '600',
  },
  choiceLabelSelected: {
    color: 'white',
  },
  consent: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  checkbox: {
    fontSize: 24,
  },
  consentText: {
    flex: 1,
    fontSize: 14,
  },
  topBar: {
    position: 'absolute',
    top: 48,
    alignSelf: 'center',
    alignItems: 'center',
    gap: 8,
  },
  progress: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  letterBadge: {
    alignItems: 'center',
    borderRadius: 24,
    justifyContent: 'center',
    minWidth: 140,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  letter: {
    color: 'white',
    fontSize: 96,
    fontWeight: '800',
  },
  variant: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  status: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    fontSize: 20,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusRecording: {
    backgroundColor: '#D92626',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  summaryLetter: {
    fontSize: 28,
    fontWeight: '800',
    width: 48,
  },
  summaryId: {
    color: '#6B7280',
    width: 32,
  },
  summaryCount: {
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  warning: {
    color: '#D92626',
  },
});
