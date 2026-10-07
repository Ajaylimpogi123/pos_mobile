import { ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { layout, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type ChipFilterRowProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  /** Test IDs: `<prefix>-<value>`. */
  testIDPrefix: string;
};

/**
 * A single-choice, horizontally scrolling row of 44 dp filter pills under a
 * list's filters (e.g. a status; selected: solid emerald), padded and capped
 * like `ListFilters` so it lines up with the grid.
 */
export function ChipFilterRow<T extends string>({ options, value, onChange, accessibilityLabel, testIDPrefix }: ChipFilterRowProps<T>) {
  const { screenPaddingX, contentMaxWidth } = useResponsive();
  return (
    <View style={[styles.container, { maxWidth: contentMaxWidth ?? layout.contentMaxWidth, paddingHorizontal: screenPaddingX }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // Bleeds to the screen edges, so the pills scroll edge to edge while the first one lines up with the grid.
        style={{ marginHorizontal: -screenPaddingX }}
        contentContainerStyle={[styles.chips, { paddingHorizontal: screenPaddingX }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={accessibilityLabel}
        testID={`${testIDPrefix}s`}
      >
        {options.map((option) => (
          <ChoiceChip
            key={option.value}
            label={option.label}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
            testID={`${testIDPrefix}-${option.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
