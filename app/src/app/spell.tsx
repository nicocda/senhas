import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { useHandTracking } from '@/camera/use-hand-tracking';
import { catalog, letterOf } from '@/catalog/catalog';
import { spell, SPELLING_PREFIX, spellingWords } from '@/catalog/spelling';
import { Button } from '@/components/button';
import {
  ConsentCheckbox,
  DominantHandChoice,
  newParticipantCode,
  ParticipantCode,
} from '@/components/session-setup';
import { createSession, deleteSession, discardTake, saveTake } from '@/dataset/db';
import { deleteSessionExports, shareSession } from '@/dataset/export';
import { debugLog } from '@/debug/debug-log';

/**
 * Records whole words spelled letter by letter, as continuous takes: the data to
 * measure the interpretation engine (Hito 5) on what it has to solve live —
 * transitions between letters, trembling, double letters — with the word as the
 * expected answer.
 */

const PREPARE_MS = 2500;
/** Time at rest before and after the word, inside the take. */
const REST_MS = 1500;
const DEFAULT_SECONDS_PER_LETTER = 1.5;
const MAX_SECONDS_PER_LETTER = 5;
/** A take with the hand in fewer frames than this share is not saved: the word is repeated. */
const MIN_TAKE_VALID_RATIO = 0.3;

/** "1.5" or "1,5" -> seconds; null if it isn't a number in (0, MAX]. */
function parseSeconds(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value <= MAX_SECONDS_PER_LETTER ? value : null;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** How long the take for a word lasts at most: rest, the letters, rest. */
function recordMsFor(word: string, secondsPerLetter: number): number {
  return 2 * REST_MS + spell(word).length * secondsPerLetter * 1000;
}

interface SpellSetup {
  sessionId: string;
  participant: string;
  words: string[];
  secondsPerLetter: number;
}

export default function SpellScreen() {
  const [setup, setSetup] = useState<SpellSetup | null>(null);
  if (setup == null) {
    return <SetupForm onStart={setSetup} />;
  }
  return (
    <CameraPermissionGate>
      <SpellRun setup={setup} />
    </CameraPermissionGate>
  );
}

function SetupForm({ onStart }: { onStart: (setup: SpellSetup) => void }) {
  const [participant] = useState(newParticipantCode);
  const [dominantHand, setDominantHand] = useState<'left' | 'right'>('right');
  const [secondsText, setSecondsText] = useState(String(DEFAULT_SECONDS_PER_LETTER));
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const seconds = parseSeconds(secondsText);
  const totalMs =
    seconds == null
      ? null
      : spellingWords.reduce((sum, word) => sum + PREPARE_MS + recordMsFor(word, seconds), 0);

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
      const words = shuffle(spellingWords);
      debugLog(
        `Sesión de deletreo ${sessionId.slice(0, 8)} (${participant}): ${words.length} palabras`,
      );
      onStart({ sessionId, participant, words, secondsPerLetter: seconds });
    } catch (error) {
      setStarting(false);
      debugLog(`Error al crear la sesión: ${String(error)}`, 'error');
      Alert.alert('No se pudo crear la sesión', String(error));
    }
  };

  return (
    <SafeAreaView style={styles.fill}>
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.title}>Deletrear palabras</Text>
        <Text style={styles.message}>
          {spellingWords.length} palabras en orden aleatorio
          {totalMs != null && `, unos ${Math.ceil(totalMs / 60000)} minutos`}. Cada una empieza y
          termina con la mano abajo, en reposo; en el medio, deletreala a tu ritmo.
        </Text>

        <ParticipantCode code={participant} />

        <Text style={styles.label}>Segundos por letra (como máximo)</Text>
        <TextInput
          style={[styles.input, seconds == null && styles.inputInvalid]}
          value={secondsText}
          onChangeText={setSecondsText}
          keyboardType="decimal-pad"
        />
        {seconds == null && (
          <Text style={styles.warning}>
            Tiene que ser un número mayor que 0 y hasta {MAX_SECONDS_PER_LETTER}.
          </Text>
        )}
        <Text style={styles.hint}>
          Si terminás antes, tocá «Terminé»: el tiempo que sobra no hace falta.
        </Text>

        <DominantHandChoice value={dominantHand} onChange={setDominantHand} />
        <ConsentCheckbox checked={consent} onChange={setConsent} />

        <Button
          label={starting ? 'Preparando…' : 'Empezar'}
          onPress={start}
          disabled={!consent || seconds == null || starting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

type Phase = 'prepare' | 'record' | 'done';

function SpellRun({ setup }: { setup: SpellSetup }) {
  const { sessionId, participant, secondsPerLetter } = setup;
  const router = useRouter();
  const [words, setWords] = useState(setup.words);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('prepare');
  const [noHand, setNoHand] = useState(false);
  const [lastTake, setLastTake] = useState<{ id: string; word: string } | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const recordStartedAt = useRef(0);
  /** The take is being saved: the timer and the button must not finish it twice. */
  const finishing = useRef(false);

  const word = phase === 'done' ? null : words[index];
  const { frameOutput, landmarks, body, imageSize, startRecording, stopRecording } =
    useHandTracking({
      // Same as Detectar: two hands (Ñ, Q, W, X) and the face.
      numHands: 2,
      bodyReference: 'face',
    });

  const finish = useCallback(async () => {
    if (word == null || finishing.current) {
      return;
    }
    finishing.current = true;
    const take = stopRecording();
    const valid = take.frames.filter((frame) => frame.hands.length > 0).length;
    try {
      if (valid < take.frames.length * MIN_TAKE_VALID_RATIO || valid === 0) {
        debugLog(`${word}: ${valid}/${take.frames.length} cuadros con mano, se repite`, 'warn');
        setNoHand(true);
        setPhase('prepare');
        return;
      }
      const id = await saveTake({
        ...take,
        sessionId,
        entryId: SPELLING_PREFIX + word,
        round: 1,
        startedAt: recordStartedAt.current,
      });
      debugLog(
        `${word}: ${valid}/${take.frames.length} cuadros con mano, ${
          Math.round((take.frames.at(-1)?.t ?? 0) / 100) / 10
        } s`,
      );
      setLastTake({ id, word });
      setSaved((items) => [...items, word]);
      setNoHand(false);
      if (index + 1 < words.length) {
        setIndex(index + 1);
        setPhase('prepare');
      } else {
        setPhase('done');
      }
    } catch (error) {
      debugLog(`Error al guardar ${word}: ${String(error)}`, 'error');
      Alert.alert('No se pudo guardar la toma', String(error));
      setPhase('prepare');
    } finally {
      finishing.current = false;
    }
  }, [word, index, words.length, sessionId, stopRecording]);

  useEffect(() => {
    if (word == null) {
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
    if (phase === 'record') {
      const timer = setTimeout(finish, recordMsFor(word, secondsPerLetter));
      return () => clearTimeout(timer);
    }
  }, [phase, word, secondsPerLetter, startRecording, finish]);

  // Leaving the screen mid-take: the frames are dropped.
  useEffect(() => () => void stopRecording(), [stopRecording]);

  /** Discards the previous take and puts its word next in line. */
  const repeatLast = async () => {
    if (lastTake == null || phase === 'record') {
      return;
    }
    const { id, word: repeated } = lastTake;
    setLastTake(null);
    try {
      await discardTake(id);
    } catch (error) {
      debugLog(`Error al descartar ${repeated}: ${String(error)}`, 'error');
      Alert.alert('No se pudo descartar la toma', String(error));
      return;
    }
    debugLog(`${repeated} descartada: se repite`);
    setSaved((items) => {
      const at = items.lastIndexOf(repeated);
      return at < 0 ? items : [...items.slice(0, at), ...items.slice(at + 1)];
    });
    const insertAt = phase === 'done' ? words.length : index;
    setWords([...words.slice(0, insertAt), repeated, ...words.slice(insertAt)]);
    setIndex(insertAt);
    setNoHand(false);
    setPhase('prepare');
  };

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

  if (phase === 'done' || word == null) {
    return (
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.form}>
          <Text style={styles.title}>¡Listo!</Text>
          <Text style={styles.message}>
            Código de esta sesión: <Text style={styles.codeInline}>{participant}</Text>
          </Text>
          <Text style={styles.message}>
            {saved.length} palabras grabadas: {saved.join(', ')}.
          </Text>
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
          Palabra {index + 1}/{words.length}
        </Text>
        <View style={styles.word}>
          {spell(word).map((entry, position) => (
            <Text key={position} style={[styles.wordLetter, { color: entry.color }]}>
              {letterOf(entry)}
            </Text>
          ))}
        </View>
        <Text style={[styles.status, recording && styles.statusRecording]}>
          {recording
            ? '● Grabando: deletreá y volvé al reposo'
            : noHand
              ? 'No vi tu mano: repetimos'
              : 'Mano abajo, en reposo…'}
        </Text>
      </View>
      <View style={styles.bottomBar}>
        {recording ? (
          <Button label="Terminé" onPress={finish} />
        ) : (
          lastTake != null && <Button label={`Repetir ${lastTake.word}`} onPress={repeatLast} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
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
  codeInline: {
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  hint: {
    color: '#6B7280',
  },
  warning: {
    color: '#D92626',
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
  word: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  wordLetter: {
    fontSize: 56,
    fontWeight: '800',
  },
  status: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    fontSize: 18,
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
});
