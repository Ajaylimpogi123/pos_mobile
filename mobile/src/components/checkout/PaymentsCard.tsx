import { memo, type Ref } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';

import { Banner } from '@/components/ui/Banner';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import {
  colors,
  hitTarget,
  iconSizes,
  numeric,
  opacity,
  pressedScale,
  radius,
  sizes,
  spacing,
  status,
  typography,
} from '@/constants/theme';
import { typedCents, type CheckoutState } from '@/hooks/sell/useCheckout';
import { exactCashCents, GCASH_OVER_TOTAL_MESSAGE, PAYMENT_LIMITS, QUICK_CASH_CENTS } from '@/sale/payments';
import { formatPeso } from '@/utils/money';

type CheckoutProps = {
  checkout: CheckoutState;
};

/** Quick-cash buttons: 52 dp. */
const QUICK_HEIGHT = sizes.inputHeight;

/** An uppercase section label ("PAYMENT METHOD"). */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={styles.sectionLabel} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** The large tabular amount the customer owes (the sale's total). */
export function AmountDueCard({ totalCents }: { totalCents: number }) {
  const amount = formatPeso(totalCents);
  return (
    <View style={styles.dueCard} accessible accessibilityLabel={`Amount due: ${amount}`} testID="checkout-amount-due">
      <Text style={styles.dueLabel}>Amount due</Text>
      <Text style={styles.dueValue} numberOfLines={1} adjustsFontSizeToFit>
        {amount}
      </Text>
    </View>
  );
}

type MethodTileProps = {
  label: string;
  detail: string;
  icon: IconName;
  checked: boolean;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint: string;
  testID: string;
};

const MethodTile = memo(function MethodTile({
  label,
  detail,
  icon,
  checked,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: MethodTileProps) {
  const ink = checked ? colors.primaryDark : colors.textResting;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.method,
        checked ? styles.methodChecked : styles.methodIdle,
        pressed && styles.methodPressed,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Icon name={icon} size={iconSizes.lg} color={ink} />
      <Text style={[styles.methodLabel, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.methodDetail} numberOfLines={1}>
        {detail}
      </Text>
    </Pressable>
  );
});

/**
 * The payment methods that exist (Cash, GCash) as tiles, highlighted while
 * they are part of the payment. Cash focuses the cash field; GCash adds a
 * GCash payment (reference required; up to 5 payments in all), which is also
 * how a payment is split.
 */
export function PaymentMethods({ checkout, onCash }: CheckoutProps & { onCash: () => void }) {
  const { draft, locked } = checkout;
  const cashCents = typedCents(draft.cash) ?? 0;
  const gcashCount = draft.gcash.length;
  let gcashDetail = 'Add a payment';
  if (gcashCount === 1) gcashDetail = '1 payment · add another';
  else if (gcashCount > 1) gcashDetail = `${gcashCount} payments · add another`;

  return (
    <View style={styles.section}>
      <SectionLabel>Payment method</SectionLabel>
      <View style={styles.methods} accessibilityLabel="Payment method">
        <MethodTile
          label="Cash"
          detail={cashCents > 0 ? formatPeso(cashCents) : 'Enter the amount'}
          icon="cash-outline"
          checked={cashCents > 0}
          onPress={onCash}
          disabled={locked}
          accessibilityHint="Goes to the cash received field"
          testID="checkout-method-cash"
        />
        <MethodTile
          label="GCash"
          detail={gcashDetail}
          icon="phone-portrait-outline"
          checked={gcashCount > 0}
          onPress={checkout.addGcash}
          disabled={!checkout.canAddGcash}
          accessibilityHint="Adds a GCash payment"
          testID="checkout-add-gcash"
        />
      </View>
    </View>
  );
}

/** The cash handed over: a large field (it takes the keyboard too). */
export function CashInput({ checkout, inputRef }: CheckoutProps & { inputRef: Ref<TextInput> }) {
  const { draft, tenderErrors, locked } = checkout;
  return (
    <Input
      ref={inputRef}
      label="Cash received"
      prefix="₱"
      value={draft.cash}
      onChangeText={checkout.setCash}
      placeholder="0.00"
      keyboardType="decimal-pad"
      error={tenderErrors?.cash}
      editable={!locked}
      testID="checkout-cash"
    />
  );
}

type QuickButtonProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
  testID: string;
};

const QuickButton = memo(function QuickButton({ label, selected, onPress, disabled, testID }: QuickButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === 'Exact' ? 'Exact amount' : `Cash ${label}`}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quick,
        selected ? styles.quickSelected : styles.quickIdle,
        pressed && (selected ? styles.quickSelectedPressed : styles.quickIdlePressed),
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <Text style={[styles.quickLabel, selected && styles.quickLabelSelected]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
});

/** Quick cash: Exact, ₱100, ₱500, ₱1,000 (the selected one is solid dark emerald). */
export function QuickCash({ checkout }: CheckoutProps) {
  const { draft, locked } = checkout;
  const cashCents = typedCents(draft.cash);
  const exact = exactCashCents(checkout.cart.pricing.total_cents, draft);
  return (
    <View style={styles.section}>
      <SectionLabel>Quick cash</SectionLabel>
      <View style={styles.quickRow}>
        <QuickButton
          label="Exact"
          selected={cashCents !== null && cashCents === exact && exact > 0}
          onPress={checkout.setExactCash}
          disabled={locked || exact === 0}
          testID="checkout-cash-exact"
        />
        {QUICK_CASH_CENTS.map((cents) => (
          <QuickButton
            key={cents}
            label={formatPeso(cents).replace(/\.00$/, '')}
            selected={cashCents === cents}
            onPress={() => checkout.setQuickCash(cents)}
            disabled={locked}
            testID={`checkout-cash-${cents}`}
          />
        ))}
      </View>
    </View>
  );
}

/** The GCash payments (amount + reference each), with remove. */
export function GcashPayments({ checkout }: CheckoutProps) {
  const { draft, tenderErrors, locked } = checkout;
  if (draft.gcash.length === 0) return null;
  return (
    <View style={styles.section}>
      {draft.gcash.map((row, index) => {
        const errors = tenderErrors?.gcash[row.key];
        return (
          <View key={row.key} style={styles.gcash} testID={`checkout-gcash-${index}`}>
            <View style={styles.gcashHeader}>
              <View style={styles.gcashIcon}>
                <Icon name="phone-portrait-outline" size={iconSizes.md} color={colors.primaryDark} />
              </View>
              <Text style={styles.gcashTitle}>GCash payment{draft.gcash.length > 1 ? ` ${index + 1}` : ''}</Text>
              <IconButton
                icon="close"
                variant="ghost"
                accessibilityLabel={`Remove GCash payment ${index + 1}`}
                onPress={() => checkout.removeGcash(row.key)}
                disabled={locked}
                testID={`checkout-gcash-${index}-remove`}
              />
            </View>
            <Input
              label="Amount"
              prefix="₱"
              value={row.amount}
              onChangeText={(amount) => checkout.updateGcash(row.key, { amount })}
              placeholder="0.00"
              keyboardType="decimal-pad"
              error={errors?.amount}
              editable={!locked}
              testID={`checkout-gcash-${index}-amount`}
            />
            <Input
              label="Reference number"
              value={row.reference}
              onChangeText={(reference) => checkout.updateGcash(row.key, { reference })}
              placeholder="e.g. 1012345678901"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={PAYMENT_LIMITS.referenceMax}
              error={errors?.reference}
              editable={!locked}
              testID={`checkout-gcash-${index}-reference`}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * The live result: the change (in the completed colour) once the payments
 * cover the total, else what is still due; "Paid X of Y" under it, and the
 * payment rules the draft breaks.
 */
export function PaymentResult({ checkout }: CheckoutProps) {
  const { summary, tenderErrors } = checkout;
  const total = checkout.cart.pricing.total_cents;
  return (
    <View style={styles.section}>
      <View style={[styles.result, summary.short ? styles.resultDue : styles.resultChange]} testID="checkout-result">
        <View style={styles.resultText}>
          <Text style={[styles.resultLabel, summary.short ? styles.dueText : styles.changeText]}>
            {summary.short ? 'Still due' : 'Change'}
          </Text>
          <Text style={styles.paid} testID="checkout-paid">
            Paid {formatPeso(summary.paidCents)} of {formatPeso(total)}
          </Text>
        </View>
        {summary.short ? (
          <Text style={[styles.resultValue, styles.dueText]} numberOfLines={1} adjustsFontSizeToFit testID="checkout-due">
            {formatPeso(summary.dueCents)}
          </Text>
        ) : (
          <Text style={[styles.resultValue, styles.changeText]} numberOfLines={1} adjustsFontSizeToFit testID="checkout-change">
            {formatPeso(summary.changeCents)}
          </Text>
        )}
      </View>
      {summary.gcashOverTotal ? <Banner message={GCASH_OVER_TOTAL_MESSAGE} testID="checkout-gcash-over" /> : null}
      {tenderErrors?.general && !summary.gcashOverTotal ? (
        <Banner message={tenderErrors.general} testID="checkout-payments-error" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm + spacing.xxs,
  },
  sectionLabel: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  dueCard: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dueLabel: {
    ...typography.control,
    color: colors.textSecondary,
  },
  dueValue: {
    ...typography.hero,
    color: colors.text,
  },
  methods: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  method: {
    flex: 1,
    minHeight: sizes.methodTile,
    borderRadius: radius.cta,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  methodIdle: {
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  methodChecked: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  methodPressed: {
    transform: [{ scale: pressedScale }],
  },
  methodLabel: {
    ...typography.bodyStrong,
  },
  methodDetail: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  quick: {
    flexGrow: 1,
    flexBasis: hitTarget.large + spacing.lg,
    minHeight: QUICK_HEIGHT,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  quickIdle: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  quickIdlePressed: {
    backgroundColor: colors.surfaceMuted,
    transform: [{ scale: pressedScale }],
  },
  quickSelected: {
    borderColor: colors.primaryDark,
    backgroundColor: colors.primaryDark,
  },
  quickSelectedPressed: {
    backgroundColor: colors.primaryDarkPressed,
    transform: [{ scale: pressedScale }],
  },
  quickLabel: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
  quickLabelSelected: {
    color: colors.onPrimary,
  },
  gcash: {
    gap: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  gcashHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  gcashIcon: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gcashTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.cta,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  resultDue: {
    backgroundColor: colors.warningSoft,
  },
  resultChange: {
    backgroundColor: status.completed.tint,
  },
  resultText: {
    flex: 1,
    gap: spacing.xxs,
  },
  resultLabel: {
    ...typography.bodyStrong,
  },
  resultValue: {
    ...typography.total,
    flexShrink: 1,
  },
  dueText: {
    color: colors.warningText,
  },
  changeText: {
    color: status.completed.color,
  },
  paid: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
