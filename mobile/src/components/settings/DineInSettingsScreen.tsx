import { StyleSheet, Text, View } from 'react-native';

import { FormFooter } from '@/components/shared/FormFooter';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection, SectionDivider } from '@/components/shared/FormSection';
import { RecordLoadState } from '@/components/shared/RecordLoadState';
import { Input } from '@/components/ui/Input';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { ROUTES } from '@/constants/routes';
import { colors, spacing, typography } from '@/constants/theme';
import { useBranchSettings } from '@/hooks/settings/useReceiptSettingsForm';
import { useDineInSettingsForm } from '@/hooks/settings/useDineInSettingsForm';
import type { BranchSettings } from '@/services/types';
import { goBackOr } from '@/utils/navigation';

type DineInSettingsScreenProps = {
  /** Inside the Settings detail pane (tablets). */
  embedded?: boolean;
  onBack?: () => void;
};

function backToSettings() {
  goBackOr(ROUTES.settings);
}

function DineInForm({ settings, embedded, onBack }: { settings: BranchSettings; embedded: boolean; onBack: () => void }) {
  const form = useDineInSettingsForm(settings);
  return (
    <FormLayout
      title={embedded ? 'Dine-in' : 'Dine-in settings'}
      subtitle={embedded ? 'Tables, open bills and the service charge.' : null}
      onBack={onBack}
      banner={form.banner}
      fieldErrors={form.errors}
      footer={
          <FormFooter
            onCancel={embedded ? undefined : onBack}
            cancelDisabled={form.submitting}
            saveTitle={"Save settings"}
            onSave={form.submit}
            saving={form.submitting}
            saveDisabled={form.submitting}
            saveTestID="dine-in-save"
          />
      }
      notice={form.notice}
      embedded={embedded}
      testID="dine-in-settings-screen"
      main={
        <>
          <FormSection title="Dine-in" style={styles.rows}>
            <SwitchRow
              label="Use tables and open bills"
              description="On: Sell gets a Pay now | Tables switch, and guests can order in rounds and pay at the end. Off: every sale is paid when ordered."
              value={form.enabled}
              onValueChange={form.setEnabled}
              error={form.errors.enabled}
              disabled={form.submitting}
              testID="dine-in-enabled"
            />
            <SectionDivider />
            <Input
              label="Service charge (%)"
              value={form.percent}
              onChangeText={form.setPercent}
              error={form.errors.serviceCharge}
              placeholder="0"
              keyboardType="decimal-pad"
              editable={!form.submitting}
              returnKeyType="done"
              onSubmitEditing={form.submit}
              testID="dine-in-service-charge"
            />
            <SectionDivider />
            <View style={styles.field}>
              <Input
                label="Hold reserved tables from (minutes)"
                value={form.holdMinutes}
                onChangeText={form.setHoldMinutes}
                error={form.errors.holdMinutes}
                placeholder="60"
                keyboardType="number-pad"
                maxLength={3}
                editable={!form.submitting}
                returnKeyType="done"
                onSubmitEditing={form.submit}
                accessibilityHint="How long before the booking time the table is kept free."
                testID="dine-in-hold-minutes"
              />
              <Text style={styles.help}>How long before the booking time the table is kept free.</Text>
            </View>
          </FormSection>
        </>
      }
    />
  );
}

/**
 * Settings → **Dine-in** (`settings.manage`; Dine-in Tables & Tabs §I): the
 * on/off switch and the service charge %. Loads GET /api/v1/admin/settings
 * (loading, or the error with Retry), then the form. Full screen on phones;
 * the Settings detail pane on tablets (`embedded`).
 */
export function DineInSettingsScreen({ embedded = false, onBack = backToSettings }: DineInSettingsScreenProps) {
  const query = useBranchSettings();
  if (query.data) return <DineInForm settings={query.data} embedded={embedded} onBack={onBack} />;
  return (
    <RecordLoadState
      title="Dine-in settings"
      error={query.error}
      onRetry={() => void query.refetch()}
      onBack={onBack}
      embedded={embedded}
      testID="dine-in-load-state"
    />
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  help: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
