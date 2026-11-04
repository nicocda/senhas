import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { type LiveFrame, useHandTracking } from '@/camera/use-hand-tracking';
import { catalog } from '@/catalog/catalog';
import { Button } from '@/components/button';
import { classifierFor, classifyHand, type RecognitionMode } from '@/recognition/models';
import { PredictionSmoother, type SmoothedPrediction } from '@/recognition/smoothing';

const colorOf = new Map(catalog.letters.map((entry) => [entry.id, entry.color]));

const MODES: RecognitionMode[] = ['all', 1, 2];
const MODE_LABELS: Record<RecognitionMode, string> = {
  all: 'Todas las letras',
  1: 'Letras nivel 1',
  2: 'Letras nivel 2',
};

export default function DetectScreen() {
  return (
    <CameraPermissionGate>
      <LiveDetection />
    </CameraPermissionGate>
  );
}

function LiveDetection() {
  // One hand by default: two cost almost twice as much. A sign could switch this later.
  const [numHands, setNumHands] = useState<1 | 2>(1);
  // Which letters to recognize: all of them by default. A model that uses the
  // hand's location turns the face reference on.
  const [mode, setMode] = useState<RecognitionMode>('all');
  const [prediction, setPrediction] = useState<SmoothedPrediction | null>(null);
  const [hasHand, setHasHand] = useState(false);

  const classifier = useMemo(() => classifierFor(mode), [mode]);
  const smoother = useRef(new PredictionSmoother());

  const onLiveFrame = useCallback(
    (frame: LiveFrame) => {
      const hand = frame.hands.length === 1 ? frame.hands[0] : null;
      const result =
        hand == null
          ? null
          : classifyHand(classifier, hand, frame.body, frame.imageWidth, frame.imageHeight);
      setHasHand(hand != null);
      if (result == null) {
        smoother.current.reset();
        setPrediction(null);
        return;
      }
      const smoothed = smoother.current.push(result);
      // Re-render only when what's shown changes (letter, or confidence by 5%).
      setPrediction((previous) =>
        previous?.label === smoothed?.label &&
        Math.round((previous?.confidence ?? 0) * 20) ===
          Math.round((smoothed?.confidence ?? 0) * 20)
          ? previous
          : smoothed,
      );
    },
    [classifier],
  );

  const { frameOutput, landmarks, body, imageSize, stats } = useHandTracking({
    numHands,
    bodyReference: classifier.usesLocation ? 'face' : 'none',
    onLiveFrame,
  });

  const nextMode = () => {
    smoother.current.reset();
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
        {classifier.usesLocation && ` · cara ${stats.bodyMs} ms`}
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
            <Text style={styles.confidence}>{Math.round(prediction.confidence * 100)}%</Text>
          </>
        ) : (
          <Text style={styles.hint}>{hasHand ? '¿…?' : 'Mostrá una letra'}</Text>
        )}
      </View>
      <View style={styles.bottomBar}>
        <Button
          label={numHands === 1 ? '1 mano' : '2 manos'}
          onPress={() => setNumHands(numHands === 1 ? 2 : 1)}
        />
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
