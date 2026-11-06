import { randomUUID } from 'expo-crypto';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Pieces shared by the recording screens (letters by level, spelling): the
 * participant code, the dominant hand and the consent.
 */

/** Short pseudonymous code, e.g. P-7F3A. The session itself has a full UUID. */
export function newParticipantCode(): string {
  return `P-${randomUUID().slice(0, 4).toUpperCase()}`;
}

export function ParticipantCode({ code }: { code: string }) {
  return (
    <>
      <Text style={styles.label}>Código asignado</Text>
      <Text style={styles.code}>{code}</Text>
      <Text style={styles.hint}>
        Sin nombres: anotalo si la persona quiere que después se borren sus datos.
      </Text>
    </>
  );
}

export function DominantHandChoice({
  value,
  onChange,
}: {
  value: 'left' | 'right';
  onChange: (hand: 'left' | 'right') => void;
}) {
  return (
    <>
      <Text style={styles.label}>Mano dominante</Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Choice label="Derecha" selected={value === 'right'} onPress={() => onChange('right')} />
        </View>
        <View style={styles.flex}>
          <Choice label="Izquierda" selected={value === 'left'} onPress={() => onChange('left')} />
        </View>
      </View>
    </>
  );
}

export function ConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      style={styles.consent}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}>
      <Text style={styles.checkbox}>{checked ? '☑' : '☐'}</Text>
      <Text style={styles.consentText}>
        Acepto que se guarden las coordenadas de mi mano (nunca imágenes ni video) en este teléfono,
        para entrenar un modelo que reconozca la LSA. Puedo pedir que se borren.
      </Text>
    </Pressable>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}>
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 28,
    fontWeight: '700',
  },
  hint: {
    color: '#6B7280',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  choice: {
    alignItems: 'center',
    borderColor: '#208AEF',
    borderRadius: 8,
    borderWidth: 2,
    paddingVertical: 10,
  },
  choiceSelected: {
    backgroundColor: '#208AEF',
  },
  choiceLabel: {
    color: '#208AEF',
    fontSize: 16,
    fontWeight: '600',
  },
  choiceLabelSelected: {
    color: 'white',
  },
  consent: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  checkbox: {
    fontSize: 24,
  },
  consentText: {
    flex: 1,
    fontSize: 14,
  },
});
