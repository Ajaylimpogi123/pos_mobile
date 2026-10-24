/**
 * The recipe builder on the product edit page (§J / §L): the ingredients of
 * one serving, each with a quantity, a valid unit (`@pos/core/units`), its
 * base quantity and line cost; the cost per serving and the margin (a live
 * `BigInt` preview while edited, the server's figures once saved); **Save
 * recipe**, and **Use as product cost** (apply-cost). The picker offers active
 * ingredients only; managing ingredients is a separate module.
 */
import { LoaderCircleIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';

import { Banner } from '@/components/common/Banner';
import { FieldError } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { SearchField } from '@/components/common/SearchField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/useDebounced';
import { lineBaseQty, useIngredientOptions, useRecipeBuilder, type RecipeComponentOption } from '@/hooks/useRecipeBuilder';
import type { AdminProduct } from '@/services/types';
import { formatPeso } from '@pos/core/money';
import { formatPercentBpsOrDash } from '@pos/core/numbers';
import { formatBaseQty, formatCostRate } from '@pos/core/quantity';
import { RECIPE_MAX_LINES } from '@pos/core/recipe';

type RecipeSectionProps = {
  product: AdminProduct;
  onCostApplied: (product: AdminProduct) => void;
};

export function RecipeSection({ product, onCostApplied }: RecipeSectionProps) {
  const builder = useRecipeBuilder({ product, onCostApplied });
  const [picking, setPicking] = useState(false);

  return (
    <Card className="flex flex-col gap-4 p-5" aria-busy={builder.busy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Recipe</h2>
          <p className="text-[13px] text-muted-foreground">The ingredients one serving uses. Each sale deducts them from stock.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setPicking(true)} disabled={builder.busy || builder.full || builder.loading}>
          <PlusIcon aria-hidden="true" />
          Add ingredient
        </Button>
      </div>

      {builder.banner ? (
        <Banner
          actions={
            <Button size="sm" variant="ghost" onClick={builder.dismissBanner}>
              Dismiss
            </Button>
          }
        >
          {builder.banner}
        </Banner>
      ) : null}
      {builder.notice ? <Banner variant="success">{builder.notice}</Banner> : null}
      <FieldError message={builder.errors.lines} />

      {builder.loading ? (
        <LoadingRows rows={3} label="Loading the recipe…" />
      ) : builder.loadError ? (
        <ErrorState title="Couldn't load the recipe" message={builder.loadError} onRetry={builder.retry} />
      ) : builder.drafts.length === 0 ? (
        <EmptyState title="No ingredients yet" message="Add the ingredients one serving uses, with their quantities." />
      ) : (
        <div className="overflow-x-auto">
          <Table aria-label="Recipe ingredients">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ingredient</TableHead>
                <TableHead className="w-28">Quantity</TableHead>
                <TableHead className="w-40">Unit</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {builder.drafts.map((draft, index) => {
                const choices = builder.choicesOf(draft);
                const base = lineBaseQty(draft, choices);
                const cost = builder.lineCosts[index];
                const qtyError = builder.errors[`lines.${index}.qty`];
                const unitError = builder.errors[`lines.${index}.unit`];
                const componentError = builder.errors[`lines.${index}.component_id`];
                const qtyId = `recipe-qty-${draft.key}`;
                const unitId = `recipe-unit-${draft.key}`;
                return (
                  <TableRow key={draft.key} className="align-top hover:bg-transparent">
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{draft.name}</span>
                        {draft.type === 'product' ? (
                          <Badge tone="outline" className="w-fit">
                            Own-stock item
                          </Badge>
                        ) : null}
                        {base !== null ? (
                          <span className="text-[13px] text-muted-foreground tabular">= {formatBaseQty(base, draft.baseUnit)}</span>
                        ) : null}
                        <FieldError message={componentError} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <label htmlFor={qtyId} className="sr-only">
                        Quantity of {draft.name}
                      </label>
                      <Input
                        id={qtyId}
                        inputMode="decimal"
                        value={draft.qty}
                        onChange={(event) => builder.setQty(index, event.target.value)}
                        disabled={builder.busy}
                        aria-invalid={qtyError ? true : undefined}
                        aria-describedby={qtyError ? `${qtyId}-error` : undefined}
                        className="tabular"
                        placeholder="0"
                      />
                      <FieldError id={`${qtyId}-error`} message={qtyError} />
                    </TableCell>
                    <TableCell>
                      <label htmlFor={unitId} className="sr-only">
                        Unit of {draft.name}
                      </label>
                      {choices ? (
                        <NativeSelect
                          id={unitId}
                          value={draft.unit}
                          onChange={(event) => builder.setUnit(index, event.target.value)}
                          disabled={builder.busy || draft.type === 'product'}
                          aria-invalid={unitError ? true : undefined}
                        >
                          {choices.own.length > 0 ? (
                            <optgroup label="This ingredient's units">
                              {choices.own.map((option) => (
                                <option key={`own-${option.code}`} value={option.code}>
                                  {option.code}
                                </option>
                              ))}
                            </optgroup>
                          ) : null}
                          <optgroup label="Standard units">
                            {choices.catalog.map((option) => (
                              <option key={`catalog-${option.code}`} value={option.code}>
                                {option.code === option.name ? option.code : `${option.code} (${option.name})`}
                              </option>
                            ))}
                          </optgroup>
                        </NativeSelect>
                      ) : builder.unitsFailed(draft) ? (
                        <span className="text-[13px] text-muted-foreground">{draft.unit} (units unavailable)</span>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">{draft.unit}</span>
                      )}
                      <FieldError message={unitError} />
                    </TableCell>
                    <TableCell className="text-right tabular">{cost === null ? <span className="text-muted-foreground">—</span> : formatPeso(cost)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${draft.name}`}
                        onClick={() => builder.removeLine(draft.key)}
                        disabled={builder.busy}
                      >
                        <TrashIcon aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {builder.full ? <p className="text-[13px] text-muted-foreground">A recipe has at most {RECIPE_MAX_LINES} ingredients.</p> : null}

      <div className="grid gap-3 rounded-lg border border-border bg-subtle p-4 sm:grid-cols-3">
        <div>
          <p className="text-[13px] text-muted-foreground">Cost per serving{builder.isPreview ? ' (preview)' : ''}</p>
          <p className="text-xl font-bold tabular">{builder.costCents === null ? '—' : formatPeso(builder.costCents)}</p>
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Price</p>
          <p className="text-xl font-bold tabular">{formatPeso(builder.priceCents)}</p>
        </div>
        <div>
          <p className="text-[13px] text-muted-foreground">Margin{builder.isPreview ? ' (preview)' : ''}</p>
          <p className="text-xl font-bold text-green tabular">{formatPercentBpsOrDash(builder.marginBps, 2)}</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {builder.dirty ? (
          <Button type="button" variant="ghost" onClick={builder.discard} disabled={builder.busy}>
            Discard changes
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          onClick={builder.applyCost}
          disabled={builder.busy || builder.dirty || !builder.recipe}
          title={builder.dirty ? 'Save the recipe first.' : undefined}
        >
          {builder.applying ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {builder.applying ? 'Applying…' : 'Use as product cost'}
        </Button>
        <Button type="button" variant="green" onClick={builder.submit} disabled={builder.busy || !builder.dirty}>
          {builder.saving ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {builder.saving ? 'Saving…' : 'Save recipe'}
        </Button>
      </div>

      <IngredientPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(option) => {
          builder.addIngredient(option);
          setPicking(false);
        }}
        taken={new Set(builder.drafts.filter((draft) => draft.type === 'ingredient').map((draft) => draft.componentId))}
      />
    </Card>
  );
}

type IngredientPickerProps = {
  open: boolean;
  onClose: () => void;
  onPick: (option: RecipeComponentOption) => void;
  taken: ReadonlySet<number>;
};

function IngredientPicker({ open, onClose, onPick, taken }: IngredientPickerProps) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useIngredientOptions(search, open);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an ingredient</DialogTitle>
          <DialogDescription>Active ingredients only. Add new ingredients on the Ingredients page.</DialogDescription>
        </DialogHeader>
        <SearchField id="recipe-ingredient-search" label="Search ingredients" value={term} onChange={setTerm} placeholder="Ingredient name" slashFocus={false} />
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {list.loading ? (
            <LoadingRows rows={4} label="Loading ingredients…" />
          ) : list.error ? (
            <ErrorState title="Couldn't load the ingredients" message={list.error} onRetry={list.retry} />
          ) : list.items.length === 0 ? (
            <EmptyState title={search ? 'No matching ingredients' : 'No active ingredients'} message="Ingredients are managed on the Ingredients page." />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {list.items.map((ingredient) => {
                  const already = taken.has(ingredient.id);
                  const rate = formatCostRate(ingredient.avg_cost);
                  return (
                    <li key={ingredient.id}>
                      <button
                        type="button"
                        disabled={already}
                        onClick={() => onPick(ingredient)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">{ingredient.name}</span>
                          <span className="text-[13px] text-muted-foreground">
                            Base unit {ingredient.base_unit}
                            {rate ? ` · ${rate} / ${ingredient.base_unit}` : ''}
                          </span>
                        </span>
                        {already ? <Badge tone="outline">On the recipe</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <LoadMoreFooter
                shown={list.items.length}
                hasMore={list.hasMore}
                loading={list.loadingMore}
                onLoadMore={list.loadMore}
                error={list.loadMoreError}
                noun="ingredients"
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
