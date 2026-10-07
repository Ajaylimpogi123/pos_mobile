import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { SectionLabel } from '@/components/shared/FormSection';
import { PickerField } from '@/components/shared/PickerField';
import { PickerRow, SearchPickerSheet } from '@/components/shared/SearchPickerSheet';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, numeric, radius, sizes, spacing, typography } from '@/constants/theme';
import { RECIPE_OFFLINE_MESSAGE, type RecipeBuilderState, type RecipeLineDraft } from '@/hooks/menu/useRecipeBuilder';
import { useRecipeComponentPicker, type RecipeComponentOption } from '@/hooks/menu/useRecipeComponentPicker';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import { formatPeso } from '@/utils/money';
import { formatPercentBpsOrDash, NO_VALUE } from '@/utils/numbers';
import { formatQty } from '@/utils/quantity';
import { RECIPE_MAX_LINES } from '@/utils/recipe';

type LineEditorProps = {
  builder: RecipeBuilderState;
  draft: RecipeLineDraft;
  index: number;
};

function LineEditor({ builder, draft, index }: LineEditorProps) {
  const at = `lines.${index}`;
  const testID = `recipe-line-${index}`;
  const choices = builder.choicesOf(draft);
  const cost = builder.lineCosts[index] ?? null;
  const disabled = builder.disabled;

  let unitsBody = null;
  if (choices) {
    unitsBody = (
      <QtyUnitField
        label="Per serving"
        qty={draft.qty}
        onQtyChange={(text) => builder.setQty(index, text)}
        unit={draft.unit}
        onUnitChange={(code) => builder.setUnit(index, code)}
        choices={choices}
        error={builder.errors[`${at}.qty`]}
        unitError={builder.errors[`${at}.unit`]}
        editable={!disabled}
        placeholder="e.g. 120"
        returnKeyType="done"
        testID={testID}
      />
    );
  } else {
    // A saved ingredient line while its units load (or when they can't): the saved amount, read-only.
    unitsBody = (
      <View style={styles.pending}>
        <Text style={styles.lineAmount} testID={`${testID}-amount`}>
          {formatQty(draft.qty)} {draft.unit}
        </Text>
        {builder.unitsFailed(draft) ? (
          <Text style={styles.help}>Couldn’t load this ingredient’s units. Remove it or pick another.</Text>
        ) : (
          <ActivityIndicator color={colors.primaryBright} accessibilityLabel="Loading units" />
        )}
        {builder.errors[`${at}.qty`] || builder.errors[`${at}.unit`] ? (
          <Text style={styles.error}>{builder.errors[`${at}.qty`] ?? builder.errors[`${at}.unit`]}</Text>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.line} testID={testID}>
      <View style={styles.lineHeader}>
        <Text style={styles.lineTitle} numberOfLines={1} accessibilityRole="header">
          Component {index + 1}
        </Text>
        <Chip label={draft.type === 'product' ? 'Product' : 'Ingredient'} testID={`${testID}-type`} />
        <IconButton
          icon="trash-outline"
          variant="ghost"
          accessibilityLabel={`Remove ${draft.name}`}
          onPress={() => builder.removeLine(draft.key)}
          disabled={disabled}
          testID={`${testID}-remove`}
        />
      </View>
      <PickerField
        label="Component"
        value={draft.name}
        placeholder="Choose an ingredient"
        icon={draft.type === 'product' ? 'fast-food-outline' : 'nutrition-outline'}
        onPress={() => builder.openPicker(index)}
        error={builder.errors[`${at}.component_id`]}
        disabled={disabled}
        testID={`${testID}-component`}
      />
      {unitsBody}
      <View style={styles.costRow}>
        <Text style={styles.costLabel}>Line cost</Text>
        <Text style={styles.costValue} testID={`${testID}-cost`}>
          {cost === null ? NO_VALUE : formatPeso(cost)}
        </Text>
      </View>
    </View>
  );
}

function ComponentPicker({ builder }: { builder: RecipeBuilderState }) {
  const open = builder.pickerTarget !== null;
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const picker = useRecipeComponentPicker(debounced, open);
  const current = typeof builder.pickerTarget === 'number' ? builder.drafts[builder.pickerTarget] : undefined;
  const onRecipe = new Set(builder.drafts.map((draft) => `${draft.type}-${draft.componentId}`));

  return (
    <SearchPickerSheet<RecipeComponentOption>
      visible={open}
      title="Choose an ingredient"
      onClose={builder.closePicker}
      search={search}
      onSearchChange={setSearch}
      placeholder="Search ingredients"
      items={picker.options}
      keyOf={(option) => option.key}
      renderItem={(option) => {
        const selected = current !== undefined && current.type === option.type && current.componentId === option.id;
        const taken = !selected && onRecipe.has(`${option.type}-${option.id}`);
        return (
          <PickerRow
            title={option.name}
            subtitle={taken ? 'Already on the recipe' : option.ingredient ? `Base unit: ${option.ingredient.base_unit}` : 'Own stock, counted in pieces'}
            icon={option.type === 'product' ? 'fast-food-outline' : 'nutrition-outline'}
            selected={selected}
            disabled={taken}
            trailing={<Chip label={option.type === 'product' ? 'Product' : 'Ingredient'} />}
            onPress={() => builder.pick(option)}
            testID={`recipe-component-option-${option.key}`}
          />
        );
      }}
      loading={picker.loading}
      error={picker.error}
      onRetry={picker.retry}
      hasMore={picker.hasMore}
      loadingMore={picker.loadingMore}
      onLoadMore={picker.loadMore}
      empty={{
        title: 'No ingredients found',
        message: 'Active ingredients show here.',
        icon: 'search-outline',
      }}
      testID="recipe-component-sheet"
    />
  );
}

/** The cost summary card: cost per serving (large, green), then the price and the margin under a hairline. */
function Summary({ builder }: { builder: RecipeBuilderState }) {
  const { isCompactHeight } = useResponsive();
  const lowMargin = builder.marginBps !== null && builder.marginBps < 0;
  return (
    <View style={[styles.summary, isCompactHeight && styles.summaryCompact]} testID="recipe-summary">
      <View style={styles.summaryRow}>
        <View style={styles.summaryHead}>
          <SectionLabel>Cost per serving</SectionLabel>
        </View>
        <Text style={styles.summaryCost} testID="recipe-cost">
          {builder.costCents === null ? NO_VALUE : formatPeso(builder.costCents)}
        </Text>
      </View>
      <View style={styles.summaryDivider} />
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Price</Text>
        <Text style={styles.summaryValue} testID="recipe-price">
          {formatPeso(builder.priceCents)}
        </Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryLabel}>Margin</Text>
        <Text style={[styles.summaryValue, lowMargin && styles.summaryNegative]} testID="recipe-margin">
          {formatPercentBpsOrDash(builder.marginBps)}
        </Text>
      </View>
      {builder.isPreview ? (
        <Text style={styles.help} testID="recipe-preview-note">
          Preview from the current average costs. Save the recipe to confirm.
        </Text>
      ) : null}
    </View>
  );
}

type RecipeSectionProps = {
  builder: RecipeBuilderState;
  productId: number;
};

/**
 * The recipe of a `recipe` product (§L): its components per serving, each
 * with the component picker, qty + a valid unit (live base preview) and the
 * line cost; then the cost per serving, the price and the margin. Edited
 * values are a live `BigInt` preview; the server's numbers show after Save.
 * **Use as product cost** copies the saved recipe cost to the product.
 * Needs a connection.
 */
export function RecipeSection({ builder, productId }: RecipeSectionProps) {
  let body;
  if (builder.loading) {
    body = <LoadingState message="Loading the recipe…" testID="recipe-loading" />;
  } else if (builder.loadError) {
    body = <ErrorState message={getErrorMessage(builder.loadError)} onRetry={builder.retry} testID="recipe-error" />;
  } else if (!builder.recipe && !builder.online) {
    body = null;
  } else {
    body = (
      <>
        {builder.errors.lines ? <Banner message={builder.errors.lines} testID="recipe-lines-error" /> : null}
        {builder.drafts.length === 0 ? (
          <Text style={styles.help} testID="recipe-empty">
            No components yet. Add what one serving uses: ingredients, or items with their own stock.
          </Text>
        ) : null}
        {builder.drafts.map((draft, index) => (
          <LineEditor key={draft.key} builder={builder} draft={draft} index={index} />
        ))}
        <Button
          title="Add component"
          leftIcon="add"
          variant="tonal"
          onPress={() => builder.openPicker('new')}
          disabled={builder.disabled || builder.drafts.length >= RECIPE_MAX_LINES}
          testID="recipe-add"
        />
        <Summary builder={builder} />
        <Button
          title={builder.saving ? 'Saving recipe…' : 'Save recipe'}
          leftIcon="checkmark"
          onPress={builder.submit}
          loading={builder.saving}
          disabled={builder.disabled || !builder.dirty}
          testID="recipe-save"
        />
        {builder.dirty ? (
          <Button title="Discard changes" leftIcon="close" variant="ghost" onPress={builder.discard} disabled={builder.busy} testID="recipe-discard" />
        ) : null}
        <Button
          title="Use as product cost"
          leftIcon="pricetag-outline"
          variant="secondary"
          onPress={builder.applyCost}
          loading={builder.applying}
          disabled={builder.disabled || builder.dirty || !builder.recipe}
          testID="recipe-apply-cost"
        />
        {builder.dirty ? <Text style={styles.help}>Save the recipe first to use its cost.</Text> : null}
      </>
    );
  }

  return (
    <Card style={styles.section} testID="recipe-section">
      <View style={styles.header}>
        <SectionLabel>Recipe</SectionLabel>
        <Text style={styles.help}>What one serving uses. Each sale deducts these from stock.</Text>
      </View>
      {builder.online ? null : <Banner variant="warning" message={RECIPE_OFFLINE_MESSAGE} testID="recipe-offline" />}
      {builder.banner ? <Banner message={builder.banner} testID="recipe-banner" /> : null}
      {builder.notice ? <Banner variant="success" message={builder.notice} testID="recipe-notice" /> : null}
      {body}
      <ComponentPicker builder={builder} />
    </Card>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  line: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lineTitle: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
  lineAmount: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  pending: {
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  costLabel: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  costValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.primary,
  },
  summary: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  summaryHead: {
    flexShrink: 1,
    gap: spacing.xxs,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  summaryNegative: {
    color: colors.dangerText,
  },
  summaryCompact: {
    padding: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryLabel: {
    ...typography.body,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  summaryCost: {
    ...typography.price,
    color: colors.primary,
  },
  summaryValue: {
    ...typography.bodyStrong,
    ...numeric,
    color: colors.text,
  },
});
