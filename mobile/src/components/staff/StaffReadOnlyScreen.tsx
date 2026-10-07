import { StyleSheet, View } from 'react-native';

import { DetailRow } from '@/components/shared/InfoCard';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { Banner } from '@/components/ui/Banner';
import { Chip } from '@/components/ui/Chip';
import { ROUTES } from '@/constants/routes';
import { spacing } from '@/constants/theme';
import type { StaffUser } from '@/services/types';
import { formatLastLogin } from '@/utils/dates';
import { goBackOr } from '@/utils/navigation';

/**
 * A staff member the caller may not manage (`can_manage: false`, e.g. a
 * manager looking at an owner): details only, no inputs and no actions.
 */
export function StaffReadOnlyScreen({ staff }: { staff: StaffUser }) {
  return (
    <FormLayout
      title="Staff details"
      subtitle={staff.name}
      onBack={() => goBackOr(ROUTES.staff)}
      banner={null}
      testID="staff-readonly-screen"
      main={
        <>
          <Banner
            variant="info"
            message="View only: this account's role has permissions you don't have, so you can't change it."
            testID="staff-readonly-banner"
          />
          <FormSection title="Details">
            <DetailRow label="Name" value={staff.name} />
            <DetailRow label="Email" value={staff.email} />
            <DetailRow label="Last login" value={formatLastLogin(staff.last_login_at)} />
            <View style={styles.chips}>
              <Chip label={staff.role.name} variant="primary" icon="shield-checkmark-outline" />
              <Chip label={staff.is_active ? 'Active' : 'Inactive'} variant={staff.is_active ? 'success' : 'neutral'} />
              <Chip label={staff.has_pin ? 'PIN set' : 'No PIN'} icon="keypad-outline" />
            </View>
          </FormSection>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
