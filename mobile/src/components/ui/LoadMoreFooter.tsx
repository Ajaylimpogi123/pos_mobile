import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { colors, numeric, spacing, typography } from '@/constants/theme';
import { getErrorMessage } from '@/services/api';

export type LoadMoreState = {
  /** How many rows / cards are loaded. */
  shown: number;
  /** The total, only where the API returns one ("Showing n of N"); cursor lists have none. */
  total?: number | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Loading the next page failed (the loaded rows stay visible). */
  nextPageError?: unknown;
  fetchNextPage: () => void;
};

type LoadMoreFooterProps = LoadMoreState & {
  testID: string;
};

/**
 * The bottom of every cursor-paginated list (MASTER §3 data table, §6):
 * "Showing n" (or "Showing n of N" when the API gives a total), then a
 * **Load more** outline button while there is a next page, a spinner while it
 * loads, or the page error with **Load more** to retry.
 * Test IDs: `<id>` (the row), `<id>-count`, `<id>-button`, `<id>-loading`, `<id>-error`.
 */
export function LoadMoreFooter({ shown, total = null, hasNextPage, isFetchingNextPage, nextPageError = null, fetchNextPage, testID }: LoadMoreFooterProps) {
  const count = total !== null && total !== undefined ? `Showing ${shown} of ${total}` : `Showing ${shown}`;

  let action = null;
  if (isFetchingNextPage) {
    action = <ActivityIndicator color={colors.primaryBright} testID={`${testID}-loading`} />;
  } else if (hasNextPage || nextPageError) {
    action = <Button title="Load more" variant="secondary" onPress={fetchNextPage} testID={`${testID}-button`} />;
  }

  return (
    <View style={styles.footer} testID={testID}>
      {nextPageError ? <Banner message={getErrorMessage(nextPageError)} testID={`${testID}-error`} /> : null}
      <View style={styles.row}>
        <Text style={styles.count} testID={`${testID}-count`} accessibilityLiveRegion="polite">
          {count}
        </Text>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  count: {
    ...typography.bodySm,
    ...numeric,
    color: colors.textSecondary,
  },
});
