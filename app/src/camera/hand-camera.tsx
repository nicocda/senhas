import { type ReactNode, useEffect } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import {
  Camera,
  type CameraFrameOutput,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';

import { HandSkeleton } from '@/camera/hand-skeleton';
import { Button } from '@/components/button';
import { useIsForeground } from '@/hooks/use-is-foreground';

/** Renders `children` only once the camera permission is granted. */
export function CameraPermissionGate({ children }: { children: ReactNode }) {
  const { hasPermission, canRequestPermission, requestPermission } = useCameraPermission();

  useEffect(() => {
    if (canRequestPermission) {
      requestPermission();
    }
  }, [canRequestPermission, requestPermission]);

  if (hasPermission) {
    return children;
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

interface HandCameraProps {
  frameOutput: CameraFrameOutput;
  landmarks: SharedValue<number[]>;
  body?: SharedValue<number[]>;
  imageSize: SharedValue<{ width: number; height: number }>;
}

/** Front camera preview with the detected hands (and body reference) drawn on top. */
export function HandCamera({ frameOutput, landmarks, body, imageSize }: HandCameraProps) {
  const device = useCameraDevice('front');
  const isForeground = useIsForeground();

  if (device == null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>No se encontró una cámara frontal.</Text>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        outputs={[frameOutput]}
        resizeMode="cover"
        // The UI is locked to portrait, so frames must follow the screen, not the
        // physical device; otherwise landmarks rotate when the phone is turned.
        orientationSource="interface"
        isActive={isForeground}
      />
      <HandSkeleton landmarks={landmarks} body={body} imageSize={imageSize} mirrored />
    </View>
  );
}

const styles = StyleSheet.create({
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
});
