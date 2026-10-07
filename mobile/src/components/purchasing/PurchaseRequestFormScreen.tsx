import { useRef } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { ItemPickerField, SupplierPickerField } from '@/components/purchasing/PurchasePickers';
import { PURCHASING_OFFLINE_MESSAGE } from '@/components/purchasing/purchasingLabels';
import { DateField } from '@/components/shared/DateField';
import { FormLayout } from '@/components/shared/FormLayout';
import { FormSection } from '@/components/shared/FormSection';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { colors, numeric, radius, spacing, typography } from '@/constants/theme';
import { PR_LIMITS, usePurchaseRequestForm, type PrItemDraft, type PurchaseRequestFormState } from '@/hooks/purchasing/usePurchaseRequestForm';
import { useIsOnline } from '@/hooks/useIsOnline';
import type { PurchaseRequest } from '@/services/types';
import { formatPeso, parsePesoInput } from '@/utils/money';
import { lineTotalCents, parseQtyInput } from '@/utils/quantity';

/** `Est. ₱2,400.00` from the typed price × qty (`round_half_up`, integer centavos); `null` until both read. */
function estimateText(draft: PrItemDraft): string | null {
  const price = draft.price.trim() === '' ? null : parsePesoInput(draft.price);
  const qty = parseQtyInput(draft.qty);
  if (price === null || !qty.ok) return null;
  const total = lineTotalCents(price, qty.value);
  return total === null ? null : `Est. ${formatPeso(total)} for ${qty.value} ${draft.unit}`;
}

function ItemEditor({ form, draft, index, disabled }: { form: PurchaseRequestFormState; draft: PrItemDraft; index: number; disabled: boolean }) {
  const at = `items.${index}`;
  const choices = form.choicesOf(draft);
  const estimate = estimateText(draft);
  const testID = `pr-item-${index}`;
  const priceRef = useRef<TextInput>(null);
  const remarksRef = useRef<TextInput>(null);

  return (
    <FormSection
      title={`Item ${index + 1}`}
      accessory={
        <IconButton
          icon="trash-outline"
          variant="ghost"
          accessibilityLabel={`Remove item ${index + 1}`}
          onPress={() => form.removeItem(draft.key)}
          disabled={disabled || form.values.items.length <= 1}
          testID={`${testID}-remove`}
        />
      }
      style={styles.item}
      testID={testID}
    >
      <ItemPickerField
        type={draft.type}
        itemId={draft.itemId}
        name={draft.name}
        onChange={(option) => form.pickItem(index, option)}
        error={form.errors[`${at}.item_id`] ?? form.errors[`${at}.item_type`]}
        disabled={disabled}
        testID={`${testID}-item`}
      />
      <SupplierPickerField
        value={draft.supplier}
        onChange={(supplier) => form.pickSupplier(index, supplier)}
        error={form.errors[`${at}.supplier_id`]}
        disabled={disabled}
        testID={`${testID}-supplier`}
      />
      {choices ? (
        <QtyUnitField
          label="Quantity"
          qty={draft.qty}
          onQtyChange={(text) => form.setQty(index, text)}
          unit={draft.unit}
          onUnitChange={(code) => form.setUnit(index, code)}
          choices={choices}
          error={form.errors[`${at}.qty`]}
          unitError={form.errors[`${at}.unit`]}
          editable={!disabled}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => priceRef.current?.focus()}
          testID={testID}
        />
      ) : (
        <Text style={styles.help}>Choose the item first: its units show here.</Text>
      )}
      <Input
        label={`Estimated price per ${draft.unit || 'unit'} (optional)`}
        prefix="₱"
        value={draft.price}
        onChangeText={(text) => form.setPrice(index, text)}
        placeholder="0.00"
        keyboardType="decimal-pad"
        error={form.errors[`${at}.estimated_unit_price_cents`]}
        editable={!disabled}
        ref={priceRef}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => remarksRef.current?.focus()}
        testID={`${testID}-price`}
      />
      {estimate ? (
        <View style={styles.estimateLine}>
          <Text style={styles.estimate} accessibilityLiveRegion="polite" testID={`${testID}-estimate`}>
            {estimate}
          </Text>
        </View>
      ) : null}
      <Input
        label="Item remarks (optional)"
        value={draft.remarks}
        onChangeText={(text) => form.setItemRemarks(index, text)}
        placeholder="e.g. The 25 kg sack"
        maxLength={PR_LIMITS.remarks}
        error={form.errors[`${at}.remarks`]}
        editable={!disabled}
        ref={remarksRef}
        returnKeyType="done"
        testID={`${testID}-remarks`}
      />
    </FormSection>
  );
}

type PurchaseRequestFormScreenProps = {
  /** The PR to edit (no item decided yet); omitted when creating. */
  request?: PurchaseRequest;
  onBack: () => void;
  onSaved: (pr: PurchaseRequest) => void;
};

/**
 * Create / edit a purchase request (§L): the date needed and remarks, then
 * the items, each with the item picker (ingredients and own-stock products),
 * the supplier, the quantity with its unit and live base preview, an
 * estimated price and remarks. Tablet landscape: the request details beside
 * the items; otherwise one column. Save disables while in flight; a
 * network error keeps the ULID and Save becomes **Retry**. Needs a connection.
 */
export function PurchaseRequestFormScreen({ request, onBack, onSaved }: PurchaseRequestFormScreenProps) {
  const form = usePurchaseRequestForm({ initial: request, onSaved });
  const online = useIsOnline();
  const disabled = form.busy || form.locked || !online;

  let saveLabel = form.isEdit ? 'Save changes' : 'Submit request';
  if (form.locked) saveLabel = 'Retry';

  return (
    <FormLayout
      title={form.isEdit ? 'Edit purchase request' : 'New purchase request'}
      subtitle={request?.pr_no ?? null}
      onBack={onBack}
      banner={form.banner}
      asidePlacement="start"
      testID="pr-form-screen"
      aside={
        <FormSection title="Request" description="When it's needed, and anything the approver should know.">
          <DateField label="Date needed (optional)" value={form.values.dateNeeded} onChange={form.setDateNeeded} error={form.errors.date_needed} disabled={disabled} testID="pr-date-needed" />
          <Input
            label="Remarks (optional)"
            value={form.values.remarks}
            onChangeText={form.setRemarks}
            placeholder="e.g. For the weekend rush"
            multiline
            maxLength={PR_LIMITS.remarks}
            error={form.errors.remarks}
            editable={!disabled}
            testID="pr-remarks"
          />
        </FormSection>
      }
      main={
        <>
          {online ? null : <Banner variant="warning" message={PURCHASING_OFFLINE_MESSAGE} testID="pr-form-offline" />}
          {form.errors.items ? <Banner message={form.errors.items} testID="pr-items-error" /> : null}
          {form.values.items.map((draft, index) => (
            <ItemEditor key={draft.key} form={form} draft={draft} index={index} disabled={disabled} />
          ))}
          <Button
            title="Add item"
            leftIcon="add"
            variant="secondary"
            onPress={form.addItem}
            disabled={disabled || form.values.items.length >= PR_LIMITS.items}
            testID="pr-add-item"
          />
          <Button
            title={saveLabel}
            leftIcon={form.locked ? 'refresh' : 'checkmark'}
            size="lg"
            onPress={form.submit}
            loading={form.busy}
            disabled={form.busy || !online}
            testID="pr-save"
          />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  item: {
    gap: spacing.md,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  estimateLine: {
    alignSelf: 'flex-start',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  estimate: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.primaryDark,
  },
});
