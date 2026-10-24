import { StyleSheet, Text, View } from 'react-native';

import { ScPwdAmountRows } from '@/components/sell/ScPwdAmountRows';
import { DetailRow } from '@/components/shared/InfoCard';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { colors, spacing, typography } from '@/constants/theme';
import { personTypeLabel, scPwdModeLabel, sharedMealLine } from '@pos/core/sale/scPwd';
import type { OrderScPwd } from '@/services/types';

type ScPwdCardProps = {
  scPwd: OrderScPwd;
};

/**
 * The SC/PWD block of an order (Senior Citizen / PWD Discount → Device rules
 * → Orders detail): the mode (and the diners of a shared meal), whether the
 * eligible part was VAT-exempt, each person with their ID number, and the
 * amounts (`VAT exempted` only when it was). Every figure is the server's
 * (or the local order's, from the same pricing).
 */
export function ScPwdCard({ scPwd }: ScPwdCardProps) {
  const count = scPwd.persons.length;
  return (
    <Card style={styles.card} testID="order-sc-pwd">
      <View style={styles.head}>
        <Text style={styles.title} accessibilityRole="header">
          Senior citizen / PWD
        </Text>
        <Chip
          label={scPwd.vat_exempt ? 'VAT exempt' : 'VAT-able'}
          variant={scPwd.vat_exempt ? 'success' : 'neutral'}
          testID="order-sc-pwd-vat-status"
        />
      </View>
      <View style={styles.rows}>
        <DetailRow
          label="Applies to"
          value={scPwd.mode === 'headcount' ? sharedMealLine(scPwd.diners ?? count, count) : scPwdModeLabel(scPwd.mode)}
          testID="order-sc-pwd-mode"
        />
        {scPwd.persons.map((person, index) => (
          <DetailRow
            key={`${person.id_no}-${index}`}
            label={personTypeLabel(person.type)}
            value={`ID ${person.id_no}`}
            testID={`order-sc-pwd-person-${index}`}
          />
        ))}
      </View>
      <View style={styles.rows}>
        <ScPwdAmountRows
          vatExempt={scPwd.vat_exempt}
          reliefCents={scPwd.vat_relief_cents}
          discountCents={scPwd.discount_cents}
          testIDPrefix="order-block"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  rows: {
    gap: spacing.sm,
  },
});
