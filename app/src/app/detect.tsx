import type { BodyReferenceKind } from 'hand-landmarker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { useHandTracking } from '@/camera/use-hand-tracking';
import { Button } from '@/components/button';

const BODY_REFERENCES: BodyReferenceKind[] = ['none', 'face', 'pose'];
const BODY_LABELS: Record<BodyReferenceKind, string> = {
  none: 'Sin cara',
  face: 'Cara',
  pose: 'Pose',
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
  // Off by default: an extra model per frame. Here to compare the candidates (etapa 4.3).
  const [bodyReference, setBodyReference] = useState<BodyReferenceKind>('none');
  const { frameOutput, landmarks, body, imageSize, stats } = useHandTracking({
    numHands,
    bodyReference,
  });

  const nextBodyReference = () => {
    const index = BODY_REFERENCES.indexOf(bodyReference);
    setBodyReference(BODY_REFERENCES[(index + 1) % BODY_REFERENCES.length]);
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
        {stats.fps} FPS · copia {stats.conversionMs} ms · manos {stats.inferenceMs} ms
        {bodyReference !== 'none' &&
          ` · ${BODY_LABELS[bodyReference].toLowerCase()} ${stats.bodyMs} ms`}
      </Text>
      <View style={styles.bottomBar}>
        <Button
          label={numHands === 1 ? '1 mano' : '2 manos'}
          onPress={() => setNumHands(numHands === 1 ? 2 : 1)}
        />
        <Button label={BODY_LABELS[bodyReference]} onPress={nextBodyReference} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
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
