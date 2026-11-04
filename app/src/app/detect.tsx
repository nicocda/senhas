import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

import { HandSkeleton } from '@/camera/hand-skeleton';
import { Button } from '@/components/button';
import { useHandTracking } from '@/camera/use-hand-tracking';
import { useIsForeground } from '@/hooks/use-is-foreground';

export default function DetectScreen() {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (canRequestPermission) {
      requestPermission();
    }
  }, [canRequestPermission, requestPermission]);

  if (hasPermission) {
    return <CameraPreview />;
  }

  // Once the user denies the permission, Android won't show the dialog again:
  // the only way back is the app's system settings.
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>Señas necesita la cámara para ver tus manos.</Text>
      {canRequestPermission ? (
        <Button label="Permitir cámara" onPress={requestPermission} />
      ) : (
        <Button label="Abrir ajustes" onPress={Linking.openSettings} />
      )}
    </View>
  );
}

function CameraPreview() {
  const device = useCameraDevice('front');
  // One hand by default: two cost almost twice as much. A sign could switch this later.
  const [numHands, setNumHands] = useState<1 | 2>(1);
  const { frameOutput, landmarks, imageSize, stats } = useHandTracking({ numHands });
  const isForeground = useIsForeground();

  if (device == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>No se encontró una cámara frontal.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Camera
        style={styles.fill}
        device={device}
        outputs={[frameOutput]}
        resizeMode="cover"
        // The UI is locked to portrait, so frames must follow the screen, not the
        // physical device; otherwise landmarks rotate when the phone is turned.
        orientationSource="interface"
        isActive={isForeground}
      />
      <HandSkeleton landmarks={landmarks} imageSize={imageSize} mirrored />
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
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
