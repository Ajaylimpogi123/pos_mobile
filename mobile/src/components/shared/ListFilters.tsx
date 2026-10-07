import { ActivityIndicator, ScrollView, StyleSheet, View, type KeyboardTypeOptions } from 'react-native';

import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { colors, layout, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

/** Contract: `search` is `max:100` on every list endpoint. */
export const SEARCH_MAX_LENGTH = 100;

export type FilterSegment<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
  testID: string;
};

export type FilterChip = { id: number; label: string };

export type FilterChips = {
  items: readonly FilterChip[];
  selectedId: number | null;
  onChange: (id: number | null) => void;
  /** Label of the "no filter" chip, e.g. "All roles". */
  allLabel: string;
  /** Test IDs: `<prefix>s` (the row), `<prefix>-all`, `<prefix>-<id>`. */
  testIDPrefix: string;
};

type ListFiltersProps<T extends string> = {
  search: string;
  onSearchChange: (text: string) => void;
  /** The debounced search is loading. */
  searching: boolean;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  /** Test ID of the search input; the clear button is `<id>-clear`. */
  searchTestID: string;
  /** The endpoint's `search` limit (default 100). */
  searchMaxLength?: number;
  segment?: FilterSegment<T>;
  chips?: FilterChips;
  /**
   * The search is shown elsewhere (e.g. inline in the `ListHeader` on tablets, as
   * a `ListSearch`): only the segment and chips render here.
   */
  hideSearch?: boolean;
};

type ListSearchProps = {
  search: string;
  onSearchChange: (text: string) => void;
  searching: boolean;
  placeholder: string;
  keyboardType?: KeyboardTypeOptions;
  /** The search input; the clear button is `<id>-clear`. */
  testID: string;
  maxLength?: number;
  /** `search`: the light pill (filters row). `searchSurface`: white with a hairline border (in the top bar). */
  variant?: 'search' | 'searchSurface';
};

/** A list's search box: a spinner while the debounced search loads, a clear button once there is text. */
export function ListSearch({
  search,
  onSearchChange,
  searching,
  placeholder,
  keyboardType,
  testID,
  maxLength = SEARCH_MAX_LENGTH,
  variant = 'search',
}: ListSearchProps) {
  let searchAccessory = null;
  if (searching) {
    searchAccessory = <ActivityIndicator color={colors.primaryBright} style={styles.accessory} />;
  } else if (search !== '') {
    searchAccessory = (
      <IconButton
        icon="close-circle"
        variant="ghost"
        accessibilityLabel="Clear search"
        onPress={() => onSearchChange('')}
        testID={`${testID}-clear`}
      />
    );
  }
  return (
    <Input
      label="Search"
      variant={variant}
      value={search}
      onChangeText={onSearchChange}
      placeholder={placeholder}
      leftIcon="search"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={keyboardType}
      returnKeyType="search"
      maxLength={maxLength}
      rightAccessory={searchAccessory}
      testID={testID}
    />
  );
}

/**
 * A light pill search box, an optional segmented control and an optional row
 * of 44 dp filter pills (selected: solid emerald), for list screens.
 * - Phone portrait: search, then the segmented control, then a horizontally
 *   scrolling chip row.
 * - Landscape and tablets: search and the segmented control share one row, chips below.
 * The same elements stay in the same tree positions in every layout (only
 * `flexDirection` changes), so rotating keeps the search text and focus.
 */
export function ListFilters<T extends string>({
  search,
  onSearchChange,
  searching,
  placeholder,
  keyboardType,
  searchTestID,
  searchMaxLength = SEARCH_MAX_LENGTH,
  segment,
  chips,
  hideSearch = false,
}: ListFiltersProps<T>) {
  const { isLandscape, isTablet, screenPaddingX, contentMaxWidth, isCompactHeight } = useResponsive();
  const wide = isLandscape || isTablet;
  if (hideSearch && !segment && !chips) return null;

  return (
    <View
      style={[
        styles.container,
        { maxWidth: contentMaxWidth, paddingHorizontal: screenPaddingX, gap: isCompactHeight ? spacing.sm : spacing.md },
      ]}
    >
      <View style={[styles.topRow, wide ? styles.topRowWide : styles.topRowStacked]}>
        {hideSearch ? null : (
          <View style={wide ? styles.searchWide : styles.full}>
            <ListSearch
              search={search}
              onSearchChange={onSearchChange}
              searching={searching}
              placeholder={placeholder}
              keyboardType={keyboardType}
              maxLength={searchMaxLength}
              testID={searchTestID}
            />
          </View>
        )}
        {segment ? (
          <SegmentedControl
            options={segment.options}
            value={segment.value}
            onChange={segment.onChange}
            accessibilityLabel={segment.accessibilityLabel}
            style={wide ? styles.segmentWide : styles.full}
            testID={segment.testID}
          />
        ) : null}
      </View>

      {chips ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Bleeds to the screen edges, so the pills scroll edge to edge while the first one lines up with the search.
          style={{ marginHorizontal: -screenPaddingX }}
          contentContainerStyle={[styles.chips, { paddingHorizontal: screenPaddingX }]}
          testID={`${chips.testIDPrefix}s`}
        >
          <ChoiceChip
            label={chips.allLabel}
            selected={chips.selectedId === null}
            onPress={() => chips.onChange(null)}
            testID={`${chips.testIDPrefix}-all`}
          />
          {chips.items.map((chip) => (
            <ChoiceChip
              key={chip.id}
              label={chip.label}
              selected={chips.selectedId === chip.id}
              onPress={() => chips.onChange(chip.id)}
              testID={`${chips.testIDPrefix}-${chip.id}`}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: spacing.md,
  },
  topRow: {
    gap: spacing.md,
  },
  topRowWide: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topRowStacked: {
    flexDirection: 'column',
  },
  full: {
    width: '100%',
  },
  searchWide: {
    flex: 1,
    maxWidth: layout.searchMaxWidth,
  },
  segmentWide: {
    flex: 1,
    maxWidth: layout.segmentedMaxWidth,
  },
  accessory: {
    marginHorizontal: spacing.md,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
});
