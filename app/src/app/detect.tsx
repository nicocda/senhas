import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CameraPermissionGate, HandCamera } from '@/camera/hand-camera';
import { useHandTracking } from '@/camera/use-hand-tracking';
import { Button } from '@/components/button';

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
  const { frameOutput, landmarks, imageSize, stats } = useHandTracking({ numHands });

  return (
    <View style={styles.fill}>
      <HandCamera frameOutput={frameOutput} landmarks={landmarks} imageSize={imageSize} />
      <Text style={styles.stats}>
        {stats.fps} FPS · copia {stats.conversionMs} ms · MediaPipe {stats.inferenceMs} ms
      </Text>
      <View style={styles.bottomBar}>
        <Button
          label={numHands === 1 ? '1 mano' : '2 manos'}
          onPress={() => setNumHands(numHands === 1 ? 2 : 1)}
        />
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
  },
  stats: {
    position: 'absolute',
    top: 48,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: 'white',
    fontVariant: ['tabular-nums'],
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
