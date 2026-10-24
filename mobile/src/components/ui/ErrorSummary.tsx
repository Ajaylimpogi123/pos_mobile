import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { colors, iconSizes, radius, sizes, spacing, status, typography } from '@/constants/theme';

/** For a form's `onSelectError`: focuses the tapped field's input (fields without a ref do nothing). Call it inside the handler, not during render. */
export function focusField(field: string, refs: Readonly<Record<string, RefObject<TextInput | null>>>): void {
  refs[field]?.current?.focus();
}

/**
 * For repeated fields (line items) whose refs live in child rows: `register(field)`
 * gives an input's callback ref (e.g. `items.0.qty`), `focus(field)` is the
 * form's `onSelectError`. Fields never registered do nothing.
 */
export function useFieldInputs(): { register: (field: string) => (input: TextInput | null) => void; focus: (field: string) => void } {
  const inputs = useRef(new Map<string, TextInput>());
  return useMemo(
    () => ({
      register: (field: string) => (input: TextInput | null) => {
        if (input) inputs.current.set(field, input);
        else inputs.current.delete(field);
      },
      focus: (field: string) => inputs.current.get(field)?.focus(),
    }),
    [],
  );
}

/** One line of the error summary: the field key, its label and its first message. */
export type FormErrorItem = { field: string; label: string; message: string };

/** "first_name" → "First name". */
export function fieldLabelOf(field: string): string {
  const words = field.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A field's label for the summary: a fixed map, or a function (e.g. for line
 * fields like `items.1.qty` → "Line 2: Quantity"). A function may return
 * `null` to leave a key out (e.g. a form-level error already in a banner).
 */
export type FieldLabels = Readonly<Record<string, string>> | ((field: string) => string | null | undefined);

/** The summary lines from a form's field errors (in field order), with labels from `labels` or the field name in words. */
export function errorItemsFrom(errors: Readonly<Record<string, unknown>> | undefined, labels: FieldLabels = {}): FormErrorItem[] {
  if (!errors) return [];
  const items: FormErrorItem[] = [];
  for (const [field, message] of Object.entries(errors)) {
    if (typeof message !== 'string' || message === '') continue;
    const label = typeof labels === 'function' ? labels(field) : labels[field];
    if (label === null) continue;
    items.push({ field, label: label ?? fieldLabelOf(field), message });
  }
  return items;
}

type ErrorSummaryProps = {
  items: readonly FormErrorItem[];
  onSelect?: (field: string) => void;
};

/**
 * The error summary after a failed submit (MASTER §4): a focusable box at the
 * top of the form ("Fix 2 fields"), each line naming its field and message.
 * Screen-reader focus moves to it when it appears; tapping a line focuses
 * that field (when the form passes `onSelectError`).
 */
export function ErrorSummary({ items, onSelect }: ErrorSummaryProps) {
  const ref = useRef<View>(null);

  useEffect(() => {
    const node = ref.current ? findNodeHandle(ref.current) : null;
    if (node) AccessibilityInfo.setAccessibilityFocus?.(node);
  }, [items]);

  const title = items.length === 1 ? 'Fix 1 field' : `Fix ${items.length} fields`;
  return (
    <View ref={ref} style={styles.summary} accessibilityRole="alert" testID="form-error-summary">
      <View style={styles.summaryTitleRow} accessible accessibilityLabel={title}>
        <Icon name="alert-circle" size={iconSizes.md} color={status.cancelled.color} />
        <Text style={styles.summaryTitle}>{title}</Text>
      </View>
      {items.map((item) => (
        <Pressable
          key={item.field}
          accessibilityRole={onSelect ? 'link' : 'text'}
          accessibilityLabel={`${item.label}: ${item.message}`}
          disabled={!onSelect}
          onPress={() => onSelect?.(item.field)}
          style={({ pressed }) => [styles.summaryItem, pressed && styles.summaryItemPressed]}
          testID={`form-error-summary-${item.field}`}
        >
          <Text style={styles.summaryText}>
            <Text style={styles.summaryField}>{item.label}</Text>
            {`: ${item.message}`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: status.cancelled.border,
    backgroundColor: status.cancelled.tint,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryTitle: {
    ...typography.label,
    color: status.cancelled.text,
    flex: 1,
  },
  summaryItem: {
    minHeight: sizes.iconButton.md,
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
  },
  summaryItemPressed: {
    backgroundColor: colors.surface,
  },
  summaryText: {
    ...typography.bodySm,
    color: status.cancelled.text,
  },
  summaryField: {
    ...typography.label,
    color: status.cancelled.text,
    textDecorationLine: 'underline',
  },
});
