import { StyleSheet, Text, View } from 'react-native';

import { tableLabel } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { IconBadge } from '@/components/ui/IconBadge';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { colors, spacing, typography } from '@/constants/theme';
import { GUESTS_LIMITS, type TablesViewState } from '@/hooks/tables/useTablesView';
import { useResponsive } from '@/hooks/useResponsive';

/** A free table was tapped: how many guests (default the table's seats), then **Open bill** (POST /api/v1/tabs). */
export function OpenTabDialog({ view }: { view: TablesViewState }) {
  const { isCompactHeight, isSmallPhone } = useResponsive();
  const { draft, opening } = view;

  return (
    <DialogFrame visible={draft !== null} onRequestClose={view.cancelOpen} busy={opening} testID="open-tab-dialog">
      {isCompactHeight ? null : <IconBadge icon="restaurant-outline" />}
      <Text style={styles.title} accessibilityRole="header">
        {draft ? `Open ${tableLabel(draft.table.name)}` : 'Open bill'}
      </Text>
      <Text style={styles.message}>How many guests are at the table?</Text>
      {draft ? (
        <View style={styles.guests}>
          <Text style={styles.label}>Guests</Text>
          <QtyStepper
            value={draft.guests}
            onChange={view.setGuests}
            min={GUESTS_LIMITS.min}
            max={GUESTS_LIMITS.max}
            accessibilityLabel="Guests"
            disabled={opening}
            testID="open-tab-guests"
          />
        </View>
      ) : null}
      {draft?.error ? <Banner message={draft.error} testID="open-tab-error" /> : null}
      <View style={[styles.actions, isSmallPhone && styles.stacked]}>
        <Button title="Cancel" variant="secondary" onPress={view.cancelOpen} disabled={opening} style={styles.action} testID="open-tab-cancel" />
        <Button
          title="Open bill"
          leftIcon="checkmark"
          onPress={view.confirmOpen}
          loading={opening}
          disabled={opening}
          style={styles.action}
          testID="open-tab-confirm"
        />
      </View>
    </DialogFrame>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  guests: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stacked: {
    flexDirection: 'column-reverse',
  },
  action: {
    flexGrow: 1,
    flexBasis: 0,
  },
});
