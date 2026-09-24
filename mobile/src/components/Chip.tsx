import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, fontWeights, radii, spacing } from '@/constants/theme';

type ChipProps = {
  label: string;
  testID?: string;
};

/** Small read-only pill, e.g. for permission slugs. */
export function Chip({ label, testID }: ChipProps) {
  return (
    <View style={styles.chip} testID={testID}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.chipBackground,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  label: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.medium,
    color: colors.chipText,
  },
});
