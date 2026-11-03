import { useEffect } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';

import { useFpsFrameOutput } from '@/camera/use-fps-frame-output';

export default function CameraScreen() {
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
  const { frameOutput, fps } = useFpsFrameOutput();

  if (device == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>No se encontró una cámara frontal.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Camera style={styles.fill} device={device} outputs={[frameOutput]} isActive />
      <Text style={styles.fps}>{fps} FPS</Text>
    </View>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
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
  button: {
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  fps: {
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
