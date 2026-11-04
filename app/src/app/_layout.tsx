import { Stack } from 'expo-router';
import { View } from 'react-native';

import { DebugPanel } from '@/debug/debug-panel';

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <DebugPanel />
    </View>
  );
}
