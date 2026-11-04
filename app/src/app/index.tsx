import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';

const LEVELS = [1, 2, 3, 4] as const;

/**
 * Home menu. The camera only starts inside the screens that need it, so the
 * app doesn't run hand tracking (or keep the camera on) just by being open.
 */
export default function MenuScreen() {
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Señas</Text>

      <View style={styles.section}>
        <Button label="Detectar" onPress={() => router.push('/detect')} />
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Grabar datos</Text>
        <Text style={styles.hint}>Próximamente</Text>
        <View style={styles.levels}>
          {LEVELS.map((level) => (
            <View key={level} style={styles.level}>
              <Button label={`Nivel ${level}`} disabled />
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Ejercicios</Text>
        <Text style={styles.hint}>Por definir</Text>
        <Button label="Ejercicios" disabled />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 32,
    padding: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  section: {
    gap: 8,
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    color: '#6B7280',
  },
  levels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  level: {
    flexBasis: '48%',
    flexGrow: 1,
  },
});
