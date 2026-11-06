import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { type LiveFrame, useHandTracking } from '@/camera/use-hand-tracking';
import { catalog, letterOf } from '@/catalog/catalog';
import { Button } from '@/components/button';
import { debugLog } from '@/debug/debug-log';
import type { Prediction } from '@/recognition/classifier';
import { Interpreter, type InterpreterState } from '@/recognition/interpreter';
import { classifierFor, classifyHand, movementRecognizerFor } from '@/recognition/models';
import { PredictionSmoother, type SmoothedPrediction } from '@/recognition/smoothing';

/** Color of each letter (V: its first variant's). */
const colorOf = new Map<string, string>();
for (const entry of catalog.letters) {
  if (!colorOf.has(letterOf(entry))) {
    colorOf.set(letterOf(entry), entry.color);
  }
}

/**
 * `text`: every letter, written as text by the interpretation engine (Hito 5).
 * 1, 2: one level's classifier, frame by frame (to look at a single model).
 */
type Mode = 'text' | 1 | 2;
const MODES: Mode[] = ['text', 1, 2];
const MODE_LABELS: Record<Mode, string> = {
  text: 'Deletrear',
  1: 'Solo nivel 1',
  2: 'Solo nivel 2',
};
/** Letters of text shown: the last ones, so a long text still fits. */
const VISIBLE_LETTERS = 10;

export default function DetectScreen() {
  return (
    <CameraPermissionGate>
      <LiveDetection />
    </CameraPermissionGate>
  );
}

function LiveDetection() {
  const [mode, setMode] = useState<Mode>('text');
  return mode === 'text' ? (
    <TextDetection onNextMode={() => setMode(MODES[1])} />
  ) : (
    <LevelDetection
      level={mode}
      onNextMode={() => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length])}
    />
  );
}

/** Same comparison as React would need: re-render only when what's shown changes. */
function sameState(a: InterpreterState, b: InterpreterState): boolean {
  return (
    a.text.join() === b.text.join() &&
    a.moving === b.moving &&
    a.hypothesis?.letter === b.hypothesis?.letter &&
    Math.round((a.hypothesis?.progress ?? 0) * 4) === Math.round((b.hypothesis?.progress ?? 0) * 4)
  );
}

const EMPTY: InterpreterState = { text: [], hypothesis: null, moving: false };

function TextDetection({ onNextMode }: { onNextMode: () => void }) {
  const interpreter = useMemo(
    () =>
      new Interpreter(
        classifierFor('static'),
        classifierFor(4),
        movementRecognizerFor(),
        'right',
        (message) => debugLog(message),
      ),
    [],
  );
  const [state, setState] = useState<InterpreterState>(EMPTY);
  const [hasHand, setHasHand] = useState(false);

  const onLiveFrame = useCallback(
    (frame: LiveFrame) => {
      const next = interpreter.push(frame, Date.now());
      setHasHand(frame.hands.length > 0);
      setState((previous) => (sameState(previous, next) ? previous : next));
    },
    [interpreter],
  );

  const { frameOutput, landmarks, body, imageSize, stats } = useHandTracking({
    // Two hands for Ñ, Q, W, X; the face for location and movements.
    numHands: 2,
    bodyReference: 'face',
    onLiveFrame,
  });

  const clear = () => {
    interpreter.clear();
    setState(EMPTY);
  };

  const visible = state.text.slice(-VISIBLE_LETTERS);
  return (
    <View style={styles.fill}>
      <HandCamera
        frameOutput={frameOutput}
        landmarks={landmarks}
        body={body}
        imageSize={imageSize}
      />
      <Text style={styles.stats}>
        {stats.fps} FPS · manos {stats.inferenceMs} ms · cara {stats.bodyMs} ms
      </Text>
      <View style={styles.result}>
        <View style={styles.textBox}>
          {state.text.length > VISIBLE_LETTERS && <Text style={styles.ellipsis}>…</Text>}
          {visible.map((letter, index) => (
            <Text key={index} style={[styles.textLetter, { color: colorOf.get(letter) }]}>
              {letter}
            </Text>
          ))}
          {state.hypothesis != null && (
            // Being held: grows more opaque until it's written.
            <Text
              style={[
                styles.textLetter,
                styles.hypothesis,
                { opacity: 0.25 + 0.5 * state.hypothesis.progress },
              ]}>
              {state.hypothesis.letter}
            </Text>
          )}
          {state.text.length === 0 && state.hypothesis == null && (
            <Text style={styles.placeholder}>
              {hasHand ? 'Sostené una letra' : 'Mostrá la mano'}
            </Text>
          )}
        </View>
        {state.moving && <Text style={styles.hint}>Movimiento…</Text>}
      </View>
      <View style={styles.bottomBar}>
        <Button label={MODE_LABELS.text} onPress={onNextMode} />
        <Button label="Borrar" onPress={clear} disabled={state.text.length === 0} />
      </View>
    </View>
  );
}

function LevelDetection({ level, onNextMode }: { level: 1 | 2; onNextMode: () => void }) {
  const classifier = classifierFor(level);
  const smoother = useMemo(() => new PredictionSmoother(), []);
  const [prediction, setPrediction] = useState<SmoothedPrediction | null>(null);
  const [hasHand, setHasHand] = useState(false);

  const onLiveFrame = useCallback(
    (frame: LiveFrame) => {
      const hand = frame.hands.length === 1 ? frame.hands[0] : null;
      const raw: Prediction | null =
        hand == null
          ? null
          : classifyHand(classifier, hand, frame.body, frame.imageWidth, frame.imageHeight);
      if (raw == null) {
        smoother.reset();
      }
      const result = raw == null ? null : smoother.push(raw);
      setHasHand(frame.hands.length > 0);
      // Re-render only when what's shown changes (letter, or confidence by 5%).
      setPrediction((previous) =>
        previous?.label === result?.label &&
        Math.round((previous?.confidence ?? 0) * 20) === Math.round((result?.confidence ?? 0) * 20)
          ? previous
          : result,
      );
    },
    [classifier, smoother],
  );

  const { frameOutput, landmarks, body, imageSize, stats } = useHandTracking({
    numHands: 1,
    bodyReference: classifier.usesLocation ? 'face' : 'none',
    onLiveFrame,
  });

  return (
    <View style={styles.fill}>
      <HandCamera
        frameOutput={frameOutput}
        landmarks={landmarks}
        body={body}
        imageSize={imageSize}
      />
      <Text style={styles.stats}>
        {stats.fps} FPS · manos {stats.inferenceMs} ms
        {classifier.usesLocation && ` · cara ${stats.bodyMs} ms`}
      </Text>
      <View style={styles.result}>
        {prediction != null ? (
          <>
            <View
              style={[
                styles.letterBadge,
                { backgroundColor: colorOf.get(prediction.letter) ?? '#208AEF' },
              ]}>
              <Text style={styles.letter}>{prediction.letter}</Text>
            </View>
            <Text style={styles.hint}>{Math.round(prediction.confidence * 100)}%</Text>
          </>
        ) : (
          <Text style={styles.hint}>{hasHand ? '¿…?' : 'Mostrá una letra'}</Text>
        )}
      </View>
      <View style={styles.bottomBar}>
        <Button label={MODE_LABELS[level]} onPress={onNextMode} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  result: {
    position: 'absolute',
    top: 96,
    left: 16,
    right: 16,
    alignItems: 'center',
    gap: 6,
  },
  textBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    minHeight: 80,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  textLetter: {
    fontSize: 56,
    fontWeight: '800',
  },
  hypothesis: {
    color: '#6B7280',
  },
  ellipsis: {
    color: '#6B7280',
    fontSize: 40,
  },
  placeholder: {
    color: '#6B7280',
    fontSize: 20,
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
  hint: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    fontSize: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 48,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  stats: {
    position: 'absolute',
    top: 48,
    right: 16,
    left: 16,
    textAlign: 'right',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: 'white',
    fontVariant: ['tabular-nums'],
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
