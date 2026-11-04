import { Pressable, StyleSheet, Text } from 'react-native';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** `danger` for actions that delete data. */
  variant?: 'primary' | 'danger';
}

export function Button({ label, onPress, disabled = false, variant = 'primary' }: ButtonProps) {
  return (
    <Pressable
      style={[styles.button, variant === 'danger' && styles.danger, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  danger: {
    backgroundColor: '#D92626',
  },
  disabled: {
    backgroundColor: '#9AA5B1',
  },
  label: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
