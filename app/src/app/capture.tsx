import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { useHandTracking } from '@/camera/use-hand-tracking';
import {
  type CatalogEntry,
  catalog,
  entriesForLevel,
  extraRounds,
  letterOf,
} from '@/catalog/catalog';
import { Button } from '@/components/button';
import { randomUUID } from 'expo-crypto';

import { createSession, deleteSession, discardTake, saveTake } from '@/dataset/db';
import { normalizeHand, steadyMs } from '@/dataset/features';
import { deleteSessionExports, shareSession } from '@/dataset/export';
import { debugLog } from '@/debug/debug-log';

const ROUNDS = 3;
const PREPARE_MS = 1500;
const DEFAULT_RECORD_SECONDS = 3;
const MAX_RECORD_SECONDS = 10;
/** Below this many frames with the hand (whole session), a letter needs more takes. */
const MIN_VALID_FRAMES = 20;
/** A take with fewer frames with the hand than this is not saved: the letter is repeated. */
const MIN_TAKE_VALID_FRAMES = 3;
const MIN_TAKE_VALID_RATIO = 0.3;
/**
 * A take is steady if the hand held the letter's shape at least this long (or a
 * third of the take, if shorter). Otherwise the letter is repeated, up to
 * MAX_ATTEMPTS times: easy letters pass at once, hard ones get more takes.
 */
const MIN_STEADY_MS = 1000;
const MAX_ATTEMPTS = 3;

interface QueueItem {
  entry: CatalogEntry;
  round: number;
}

interface SessionSetup {
  sessionId: string;
  participant: string;
  dominantHand: 'left' | 'right';
  queue: QueueItem[];
  recordMs: number;
}

/** "3", "2.5" or "2,5" -> seconds; null if it isn't a number in (0, MAX]. */
function parseSeconds(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= MAX_RECORD_SECONDS ? value : null;
}

/** Short pseudonymous code, e.g. P-7F3A. The session itself has a full UUID. */
function newParticipantCode(): string {
  return `P-${randomUUID().slice(0, 4).toUpperCase()}`;
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
      <CaptureRun setup={setup} />
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
  const [participant] = useState(newParticipantCode);
  const [dominantHand, setDominantHand] = useState<'left' | 'right'>('right');
  const [secondsText, setSecondsText] = useState(String(DEFAULT_RECORD_SECONDS));
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const levelName = catalog.levels.find((l) => l.id === level)?.name ?? '';
  const seconds = parseSeconds(secondsText);
  const roundsOf = (entry: CatalogEntry) => ROUNDS + extraRounds(entry);
  const totalTakes = entries.reduce((sum, entry) => sum + roundsOf(entry), 0);
  const harder = entries.filter((entry) => extraRounds(entry) > 0);

  const start = async () => {
    if (seconds == null) {
      return;
    }
    setStarting(true);
    try {
      const sessionId = await createSession({
        participant,
        dominantHand,
        language: catalog.language.code,
        catalogSchema: catalog.schemaVersion,
        consentAt: Date.now(),
      });
      // Round by round in random order; letters with extra rounds keep appearing
      // after the others are done.
      const queue: QueueItem[] = [];
      const maxRounds = Math.max(...entries.map(roundsOf));
      for (let round = 1; round <= maxRounds; round++) {
        const inRound = entries.filter((entry) => roundsOf(entry) >= round);
        queue.push(...shuffle(inRound).map((entry) => ({ entry, round })));
      }
      debugLog(
        `Sesión ${sessionId.slice(0, 8)} (${participant}) creada: ${queue.length} tomas de ${seconds} s`,
      );
      onStart({ sessionId, participant, dominantHand, queue, recordMs: seconds * 1000 });
    } catch (error) {
      setStarting(false);
      debugLog(`Error al crear la sesión: ${String(error)}`, 'error');
      Alert.alert('No se pudo crear la sesión', String(error));
    }
  };

  return (
    <SafeAreaView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>
          Nivel {level}: {levelName}
        </Text>
        <Text style={styles.message}>
          {entries.length} letras × {ROUNDS} rondas en orden aleatorio ({totalTakes} tomas)
          {seconds != null &&
            `, unos ${Math.ceil((totalTakes * (PREPARE_MS + seconds * 1000)) / 60000)} minutos`}
          .
        </Text>
        {harder.length > 0 && (
          <Text style={styles.hint}>
            Más rondas para las letras que el último modelo reconoce peor:{' '}
            {harder.map((entry) => `${entry.id} +${extraRounds(entry)}`).join(', ')}.
          </Text>
        )}

        <Text style={styles.label}>Código asignado</Text>
        <Text style={styles.code}>{participant}</Text>
        <Text style={styles.hint}>
          Sin nombres: anotalo si la persona quiere que después se borren sus datos.
        </Text>

        <Text style={styles.label}>Segundos de grabación por letra</Text>
        <TextInput
          style={[styles.input, seconds == null && styles.inputInvalid]}
          value={secondsText}
          onChangeText={setSecondsText}
          keyboardType="decimal-pad"
        />
        {seconds == null && (
          <Text style={styles.warning}>
            Tiene que ser un número mayor que 0 y hasta {MAX_RECORD_SECONDS}.
          </Text>
        )}

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
          disabled={!consent || seconds == null || starting}
        />
      </ScrollView>
    </SafeAreaView>
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

function CaptureRun({ setup }: { setup: SessionSetup }) {
  const { sessionId, participant, dominantHand, recordMs } = setup;
  const router = useRouter();
  const [queue, setQueue] = useState(setup.queue);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('prepare');
  /** Attempt number for the current letter (0 = first). */
  const [attempt, setAttempt] = useState(0);
  /** Why the same letter is being prepared again, if it is. */
  const [retry, setRetry] = useState<'none' | 'noHand' | 'unsteady'>('none');
  /** Takes per letter where the hand didn't hold the shape: how much each letter costs. */
  const [unsteady, setUnsteady] = useState<Record<string, number>>({});
  const [lastTake, setLastTake] = useState<LastTake | null>(null);
  const [validFrames, setValidFrames] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const recordStartedAt = useRef(0);

  const current = phase === 'done' ? null : queue[index];
  const { frameOutput, landmarks, body, imageSize, startRecording, stopRecording } =
    useHandTracking({
      numHands: current?.entry.hands ?? 1,
      // Always the face (ADR 0009): letters signed on it need it, and a single model
      // for all letters needs every take recorded the same way (C vs E).
      bodyReference: 'face',
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

    // Set by the cleanup: after saving, don't move the run forward if the screen
    // was left or the take was repeated in the meantime.
    let cancelled = false;
    const timer = setTimeout(async () => {
      const take = stopRecording();
      const { frames } = take;
      const valid = frames.filter((frame) => frame.hands.length >= current.entry.hands).length;

      // The hand wasn't seen: nothing worth saving. Same letter again.
      if (valid < Math.max(MIN_TAKE_VALID_FRAMES, frames.length * MIN_TAKE_VALID_RATIO)) {
        debugLog(
          `${current.entry.id} r${current.round}: ${valid}/${frames.length} cuadros con mano, se repite`,
          'warn',
        );
        if (!cancelled) {
          setRetry('noHand');
          setPhase('prepare');
        }
        return;
      }

      // Did the hand hold the letter? Two-handed letters are measured later (level 4).
      const steady =
        current.entry.hands === 1
          ? steadyMs(
              frames.flatMap((frame) => {
                const features =
                  frame.hands.length === 1
                    ? normalizeHand(frame.hands[0].world, dominantHand)
                    : null;
                return features == null ? [] : [{ t: frame.t, features }];
              }),
            )
          : Infinity;
      const isSteady = steady >= Math.min(MIN_STEADY_MS, recordMs / 3);

      try {
        // Saved even if not steady: it shows how the letter was searched for, and
        // training keeps only the still frames (train.py --still).
        const id = await saveTake({
          ...take,
          sessionId,
          entryId: current.entry.id,
          round: current.round,
          startedAt: recordStartedAt.current,
        });
        debugLog(
          `${current.entry.id} r${current.round} intento ${attempt + 1}: ${valid}/${frames.length} con mano, ${Math.round(steady)} ms firme` +
            (frames.length > 0
              ? `, cara en ${frames.filter((frame) => frame.body.length > 0).length}`
              : ''),
          isSteady ? 'info' : 'warn',
        );
        if (cancelled) {
          return;
        }
        setLastTake({ id, item: current, validFrames: valid });
        setValidFrames((counts) => ({
          ...counts,
          [current.entry.id]: (counts[current.entry.id] ?? 0) + valid,
        }));
      } catch (error) {
        debugLog(`Error al guardar ${current.entry.id}: ${String(error)}`, 'error');
        Alert.alert('No se pudo guardar la toma', String(error));
      }
      if (cancelled) {
        return;
      }

      if (!isSteady) {
        setUnsteady((counts) => ({
          ...counts,
          [current.entry.id]: (counts[current.entry.id] ?? 0) + 1,
        }));
        // Same letter again, up to MAX_ATTEMPTS; then move on (the summary flags it).
        if (attempt + 1 < MAX_ATTEMPTS) {
          setAttempt(attempt + 1);
          setRetry('unsteady');
          setPhase('prepare');
          return;
        }
      }
      setAttempt(0);
      setRetry('none');
      if (index + 1 < queue.length) {
        setIndex(index + 1);
        setPhase('prepare');
      } else {
        setPhase('done');
      }
    }, recordMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Leaving mid-take (repeat, back button): the frames are dropped.
      stopRecording();
    };
  }, [
    phase,
    index,
    attempt,
    current,
    queue,
    sessionId,
    dominantHand,
    recordMs,
    startRecording,
    stopRecording,
  ]);

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
      debugLog(`Error al descartar ${item.entry.id}: ${String(error)}`, 'error');
      Alert.alert('No se pudo descartar la toma', String(error));
      return;
    }
    debugLog(`${item.entry.id} r${item.round} descartada: se repite`);
    setValidFrames((counts) => ({
      ...counts,
      [item.entry.id]: (counts[item.entry.id] ?? 0) - valid,
    }));
    const insertAt = phase === 'done' ? queue.length : index;
    setQueue([...queue.slice(0, insertAt), item, ...queue.slice(insertAt)]);
    setIndex(insertAt);
    setAttempt(0);
    setRetry('none');
    setPhase('prepare');
  };

  /** Deletes the whole session from the phone, after confirming. */
  const discardSession = () => {
    Alert.alert(
      'Descartar la sesión',
      `Se borran del teléfono todas las tomas de ${participant}. No se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSession(sessionId);
              deleteSessionExports(sessionId);
              debugLog(`Sesión ${sessionId.slice(0, 8)} (${participant}) descartada`);
              router.back();
            } catch (error) {
              debugLog(`Error al descartar la sesión: ${String(error)}`, 'error');
              Alert.alert('No se pudo descartar la sesión', String(error));
            }
          },
        },
      ],
    );
  };

  const exportSession = async () => {
    setExporting(true);
    try {
      const uri = await shareSession(sessionId);
      debugLog(`Exportada: ${uri}`);
    } catch (error) {
      debugLog(`Error al exportar: ${String(error)}`, 'error');
      Alert.alert('No se pudo exportar', String(error));
    } finally {
      setExporting(false);
    }
  };

  if (phase === 'done' || current == null) {
    const entries = [...new Map(queue.map((item) => [item.entry.id, item.entry])).values()];
    return (
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.title}>¡Listo!</Text>
          <Text style={styles.message}>
            Código de esta sesión: <Text style={styles.codeInline}>{participant}</Text>
          </Text>
          <Text style={styles.message}>
            Por letra: cuadros con la mano detectada y tomas en las que la mano no se quedó quieta.
          </Text>
          {/* Letters that needed the most repeats first: those are the ones to practice. */}
          {[...entries]
            .sort((a, b) => (unsteady[b.id] ?? 0) - (unsteady[a.id] ?? 0))
            .map((entry) => {
              const count = validFrames[entry.id] ?? 0;
              const repeats = unsteady[entry.id] ?? 0;
              return (
                <View key={entry.id} style={styles.summaryRow}>
                  <Text style={[styles.summaryLetter, { color: entry.color }]}>
                    {letterOf(entry)}
                  </Text>
                  <Text style={styles.summaryId}>
                    {entry.id !== letterOf(entry) ? entry.id : ''}
                  </Text>
                  <Text style={[styles.summaryCount, count < MIN_VALID_FRAMES && styles.warning]}>
                    {count}
                    {count < MIN_VALID_FRAMES ? ' (pocas)' : ''}
                  </Text>
                  <Text style={[styles.summaryCount, repeats > 0 && styles.warning]}>
                    {repeats > 0 ? `${repeats} sin firmeza` : 'firme'}
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
          <Text style={styles.hint}>
            Si no la descartás, la sesión queda guardada en este teléfono.
          </Text>
          <Button label="Descartar sesión" onPress={discardSession} variant="danger" />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const recording = phase === 'record';
  return (
    <View style={styles.fill}>
      <HandCamera
        frameOutput={frameOutput}
        landmarks={landmarks}
        body={body}
        imageSize={imageSize}
      />
      <View style={styles.topBar}>
        <Text style={styles.progress}>
          Ronda {current.round}/{ROUNDS + extraRounds(current.entry)} · {index + 1}/{queue.length}
        </Text>
        <View style={[styles.letterBadge, { backgroundColor: current.entry.color }]}>
          <Text style={styles.letter}>{letterOf(current.entry)}</Text>
        </View>
        {current.entry.id !== letterOf(current.entry) && (
          <Text style={styles.variant}>Variante {current.entry.id}</Text>
        )}
        <Text style={[styles.status, recording && styles.statusRecording]}>
          {recording
            ? '● Grabando'
            : retry === 'noHand'
              ? 'No vi tu mano: repetimos'
              : retry === 'unsteady'
                ? `Mantené la letra quieta (intento ${attempt + 1}/${MAX_ATTEMPTS})`
                : 'Preparate…'}
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
  inputInvalid: {
    borderColor: '#D92626',
    borderWidth: 2,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 28,
    fontWeight: '700',
  },
  codeInline: {
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  hint: {
    color: '#6B7280',
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
