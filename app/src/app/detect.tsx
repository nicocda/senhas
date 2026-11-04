import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { type LiveFrame, useHandTracking } from '@/camera/use-hand-tracking';
import { catalog } from '@/catalog/catalog';
import { Button } from '@/components/button';
import { LiveRecognizer, type LiveResult } from '@/recognition/live';
import { classifierFor, classifyHand, movementRecognizerFor } from '@/recognition/models';
import { PredictionSmoother } from '@/recognition/smoothing';

const colorOf = new Map(catalog.letters.map((entry) => [entry.id, entry.color]));

/** `all`: every letter, choosing the model per frame (LiveRecognizer). */
type Mode = 'all' | 1 | 2;
const MODES: Mode[] = ['all', 1, 2];
const MODE_LABELS: Record<Mode, string> = {
  all: 'Todas las letras',
  1: 'Solo nivel 1',
  2: 'Solo nivel 2',
};
const KIND_LABELS: Record<LiveResult['kind'], string> = {
  static: '',
  movement: 'movimiento',
  twoHands: 'dos manos',
};

export default function DetectScreen() {
  return (
    <CameraPermissionGate>
      <LiveDetection />
    </CameraPermissionGate>
  );
}

/** Same interface for the integrated recognizer and the single-level classifiers. */
interface Recognizer {
  push(frame: LiveFrame, now: number): LiveResult | null;
  /** Needs two hands tracked (level 4 letters). */
  twoHands: boolean;
  /** Needs the face (location relative to the eyes). */
  face: boolean;
}

function singleLevel(level: 1 | 2): Recognizer {
  const classifier = classifierFor(level);
  const smoother = new PredictionSmoother();
  return {
    twoHands: false,
    face: classifier.usesLocation,
    push(frame) {
      const hand = frame.hands.length === 1 ? frame.hands[0] : null;
      const result =
        hand == null
          ? null
          : classifyHand(classifier, hand, frame.body, frame.imageWidth, frame.imageHeight);
      if (result == null) {
        smoother.reset();
        return null;
      }
      const smoothed = smoother.push(result);
      return smoothed && { ...smoothed, kind: 'static' };
    },
  };
}

function allLetters(): Recognizer {
  const recognizer = new LiveRecognizer(
    classifierFor('static'),
    classifierFor(4),
    movementRecognizerFor(),
  );
  return { twoHands: true, face: true, push: (frame, now) => recognizer.push(frame, now) };
}

function LiveDetection() {
  const [mode, setMode] = useState<Mode>('all');
  const [prediction, setPrediction] = useState<LiveResult | null>(null);
  const [hasHand, setHasHand] = useState(false);

  // A fresh recognizer per mode: no state carried over between modes.
  const recognizer = useMemo(() => (mode === 'all' ? allLetters() : singleLevel(mode)), [mode]);

  const onLiveFrame = useCallback(
    (frame: LiveFrame) => {
      const result = recognizer.push(frame, Date.now());
      setHasHand(frame.hands.length > 0);
      // Re-render only when what's shown changes (letter, or confidence by 5%).
      setPrediction((previous) =>
        previous?.label === result?.label &&
        Math.round((previous?.confidence ?? 0) * 20) === Math.round((result?.confidence ?? 0) * 20)
          ? previous
          : result,
      );
    },
    [recognizer],
  );

  const { frameOutput, landmarks, body, imageSize, stats } = useHandTracking({
    // Two hands only when level 4 letters are possible: it costs frames per second.
    numHands: recognizer.twoHands ? 2 : 1,
    bodyReference: recognizer.face ? 'face' : 'none',
    onLiveFrame,
  });

  const nextMode = () => {
    setPrediction(null);
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  };

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
        {recognizer.face && ` · cara ${stats.bodyMs} ms`}
      </Text>
      <View style={styles.result}>
        {prediction != null ? (
          <>
            <View
              style={[
                styles.letterBadge,
                { backgroundColor: colorOf.get(prediction.label) ?? '#208AEF' },
              ]}>
              <Text style={styles.letter}>{prediction.letter}</Text>
            </View>
            <Text style={styles.confidence}>
              {Math.round(prediction.confidence * 100)}%
              {KIND_LABELS[prediction.kind] !== '' && ` · ${KIND_LABELS[prediction.kind]}`}
            </Text>
          </>
        ) : (
          <Text style={styles.hint}>{hasHand ? '¿…?' : 'Mostrá una letra'}</Text>
        )}
      </View>
      <View style={styles.bottomBar}>
        <Button label={MODE_LABELS[mode]} onPress={nextMode} />
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
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
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
  confidence: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  hint: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 6,
    color: 'white',
    fontSize: 20,
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
