/**
 * Add or edit an ingredient (§A, §D; Q-025, Q-030; `product.manage`;
 * back-office.md → Forms): the name, the base unit (`g`, `mL`, `pc`; locked
 * once the ingredient is in use: `base_unit_locked`, or after the server's
 * 409), active, the units editor (`1 <name> = [factor] <base unit>`, with the
 * reserved-code check inline while typing and each row's 422 under it), and
 * the image. `POST` / `PATCH` (changed fields; `units` as the whole set), then
 * the image step. An edited ingredient also shows its branch stock with the
 * reorder level and **Set cost** (`inventory.adjust`).
 */
import { LoaderCircleIcon, LockIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ImageField } from '@/components/common/ImageField';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { IngredientStockPanel } from '@/components/inventory/IngredientStockPanel';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { ImageStepError, type ImageChange } from '@/hooks/useCatalogAdmin';
import {
  BASE_UNIT_LOCKED_MESSAGE,
  diffIngredient,
  ingredientDraft,
  ingredientFields,
  INGREDIENT_LIMITS,
  newUnitRowKey,
  reservedNameMessage,
  useIngredient,
  useSaveIngredient,
  validateIngredient,
  type IngredientDraft,
} from '@/hooks/useIngredients';
import { useInventoryPermissions } from '@/hooks/useInventory';
import { useUnits } from '@/hooks/useRecipeBuilder';
import { cn } from '@/lib/utils';
import { isApiError } from '@/services/api';
import type { BaseUnit, Ingredient } from '@/services/types';
import { splitSaveError, type FieldErrors } from '@/utils/forms';
import { formatBaseQty, parseFactorInput } from '@pos/core/quantity';
import { BASE_UNITS } from '@pos/core/units';

export function IngredientFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = useIngredient(editing ? id : null);
  const { canManageProducts } = useInventoryPermissions();
  useShellHeader(editing ? 'Edit ingredient' : 'Add ingredient');

  if (!canManageProducts) {
    return (
      <EmptyState
        title="You don't have permission to edit ingredients"
        message="Ask a manager if you need access."
        action={
          <Button asChild variant="outline">
            <Link to="/ingredients">Back to ingredients</Link>
          </Button>
        }
      />
    );
  }
  if (editing && existing.loading) return <LoadingRows rows={8} label="Loading the ingredient…" />;
  if (editing && (existing.error || !existing.ingredient)) {
    return (
      <PlainPage title="Edit ingredient">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <IngredientForm key={existing.ingredient?.id ?? 'new'} ingredient={editing ? existing.ingredient : null} />;
}

function IngredientForm({ ingredient }: { ingredient: Ingredient | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { units: catalog } = useUnits();
  const { canAdjust } = useInventoryPermissions();
  const [draft, setDraft] = useState<IngredientDraft>(() => ingredientDraft(ingredient));
  const [image, setImage] = useState<ImageChange>({ kind: 'none' });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [imageError, setImageError] = useState<string | null>(() => (location.state as { imageError?: string } | null)?.imageError ?? null);
  const [conflictLocked, setConflictLocked] = useState(false);
  const [sentBaseUnit, setSentBaseUnit] = useState(false);
  const save = useSaveIngredient(ingredient?.id ?? null);

  const baseUnitLocked = Boolean(ingredient && (ingredient.base_unit_locked || conflictLocked));
  const failure = save.error instanceof ImageStepError ? null : save.error;
  // §D: changing a base unit in use → 409 "The base unit can't change once the ingredient is in use."
  const baseUnitConflict = isApiError(failure) && failure.status === 409 && sentBaseUnit && failure.message === BASE_UNIT_LOCKED_MESSAGE ? failure.message : null;
  const server = splitSaveError(baseUnitConflict ? null : failure, ingredientFields(draft.units.length));
  const fieldError = (field: string) => clientErrors[field] ?? server.fieldErrors[field] ?? null;

  function change(update: Partial<IngredientDraft>) {
    setDraft((current) => ({ ...current, ...update }));
    setClientErrors({});
  }

  function changeRow(index: number, patch: Partial<{ name: string; factor: string }>) {
    setDraft((current) => ({ ...current, units: current.units.map((row, at) => (at === index ? { ...row, ...patch } : row)) }));
    setClientErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[`units.${index}.${key}`];
      return next;
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const checked = validateIngredient(draft, catalog);
    setClientErrors(checked.errors);
    if (!checked.body) return;
    setImageError(null);
    const body = ingredient ? diffIngredient(ingredient, checked.body) : checked.body;
    setSentBaseUnit(body.base_unit !== undefined && ingredient !== null);
    save.mutate(
      { body, image },
      {
        onSuccess: (saved) => {
          toast.success(ingredient ? `${saved.name} saved.` : `${saved.name} added.`);
          void navigate('/ingredients');
        },
        onError: (error) => {
          if (isApiError(error) && error.status === 409 && error.message === BASE_UNIT_LOCKED_MESSAGE && body.base_unit !== undefined && ingredient) {
            // The base unit is in use: lock it and undo the change.
            setConflictLocked(true);
            setDraft((current) => ({ ...current, baseUnit: ingredient.base_unit }));
            return;
          }
          if (!(error instanceof ImageStepError)) return;
          if (ingredient) {
            setImage({ kind: 'none' });
            setImageError(error.message);
          } else {
            void navigate(`/ingredients/${error.savedId}`, { replace: true, state: { imageError: error.message } });
          }
        },
      },
    );
  }

  const baseUnitMessage = fieldError('base_unit') ?? baseUnitConflict;

  return (
    <PlainPage title={ingredient ? `Edit ${ingredient.name}` : 'Add ingredient'} subtitle="Counted, bought and used in recipes in one base unit.">
      <div className="flex w-full max-w-[720px] flex-col gap-4">
        <form onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
          <ErrorSummary />
          <div className="flex flex-col gap-4">
            {server.banner ? <Banner>{server.banner}</Banner> : null}
            {imageError ? <Banner variant="warning">{imageError}</Banner> : null}

            <Card className="flex flex-col gap-5 p-5">
              <h2 className="text-base font-semibold">Details</h2>
              <FormField label="Name" error={fieldError('name')}>
                <Input value={draft.name} maxLength={INGREDIENT_LIMITS.name} onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Flour" />
              </FormField>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Base unit</legend>
                <div role="radiogroup" aria-label="Base unit" className="grid gap-2 sm:grid-cols-3">
                  {BASE_UNITS.map((option) => {
                    const checked = draft.baseUnit === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        disabled={baseUnitLocked && !checked}
                        onClick={() => (baseUnitLocked ? undefined : change({ baseUnit: option.value as BaseUnit }))}
                        className={cn(
                          'flex flex-col gap-1 rounded-lg border p-3 text-left disabled:opacity-60',
                          checked ? 'border-green bg-green-soft' : 'border-border bg-card hover:bg-row-hover',
                        )}
                      >
                        <span className="text-sm font-semibold">{option.label}</span>
                        <span className="text-[13px] text-muted-foreground">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
                {baseUnitLocked ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <LockIcon className="size-3.5" aria-hidden="true" />
                    {BASE_UNIT_LOCKED_MESSAGE}
                  </p>
                ) : null}
                <FieldError message={baseUnitMessage} />
              </fieldset>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="ingredient-active">Active</Label>
                  <p className="text-[13px] text-muted-foreground">Inactive ingredients can't be added to recipes or purchase requests.</p>
                  <FieldError message={fieldError('is_active')} />
                </div>
                <Switch id="ingredient-active" checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
              </div>
            </Card>

            <Card className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Units</h2>
                  <p className="text-[13px] text-muted-foreground">
                    How you buy or measure it, in {draft.baseUnit}. A standard unit (
                    {draft.baseUnit === 'pc' ? 'dozen' : draft.baseUnit === 'g' ? 'kg, lb' : 'L, cup'}) is already built in.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={draft.units.length >= INGREDIENT_LIMITS.units}
                  onClick={() => change({ units: [...draft.units, { key: newUnitRowKey(), name: '', factor: '' }] })}
                >
                  <PlusIcon aria-hidden="true" />
                  Add unit
                </Button>
              </div>
              <FieldError message={fieldError('units')} />
              {draft.units.length === 0 ? <p className="text-sm text-muted-foreground">No own units yet, e.g. a sack of 25,000 g.</p> : null}
              {draft.units.map((row, index) => {
                const nameError = fieldError(`units.${index}.name`) ?? fieldError(`units.${index}`) ?? reservedNameMessage(row.name, draft.baseUnit, catalog);
                const factorError = fieldError(`units.${index}.factor`);
                const factor = parseFactorInput(row.factor);
                const hint = factor.ok && row.name.trim() !== '' ? `1 ${row.name.trim()} = ${formatBaseQty(factor.value, draft.baseUnit)}` : null;
                const nameId = `unit-${row.key}-name`;
                const factorId = `unit-${row.key}-factor`;
                return (
                  <div key={row.key} className="flex flex-col gap-1 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex min-w-[160px] flex-1 flex-col gap-1.5">
                        <Label htmlFor={nameId}>Unit {index + 1}</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground" aria-hidden="true">
                            1
                          </span>
                          <Input
                            id={nameId}
                            value={row.name}
                            maxLength={INGREDIENT_LIMITS.unitName}
                            placeholder="e.g. sack"
                            autoComplete="off"
                            onChange={(event) => changeRow(index, { name: event.target.value })}
                            aria-invalid={nameError ? true : undefined}
                            aria-describedby={nameError ? `${nameId}-error` : undefined}
                          />
                        </div>
                      </div>
                      <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                        <Label htmlFor={factorId}>Equals ({draft.baseUnit})</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground" aria-hidden="true">
                            =
                          </span>
                          <Input
                            id={factorId}
                            inputMode="decimal"
                            value={row.factor}
                            placeholder="e.g. 25000"
                            autoComplete="off"
                            className="tabular"
                            onChange={(event) => changeRow(index, { factor: event.target.value })}
                            aria-invalid={factorError ? true : undefined}
                            aria-describedby={factorError ? `${factorId}-error` : undefined}
                          />
                          <span className="text-sm text-muted-foreground">{draft.baseUnit}</span>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove unit ${row.name.trim() || index + 1}`}
                        onClick={() => {
                          change({ units: draft.units.filter((other) => other.key !== row.key) });
                        }}
                      >
                        <TrashIcon aria-hidden="true" />
                      </Button>
                    </div>
                    {hint ? <p className="text-[13px] text-muted-foreground tabular">{hint}</p> : null}
                    <FieldError id={`${nameId}-error`} message={nameError} />
                    <FieldError id={`${factorId}-error`} message={factorError} />
                  </div>
                );
              })}
            </Card>

            <Card className="flex flex-col gap-5 p-5">
              <ImageField
                label="Image (optional)"
                imageUrl={ingredient?.image_url ?? null}
                imagePath={ingredient?.image_path ?? null}
                value={image}
                onChange={(next) => {
                  setImage(next);
                  setImageError(null);
                }}
                baseName={ingredient ? `ingredient-${ingredient.id}` : 'ingredient'}
                error={fieldError('image')}
                disabled={save.isPending}
              />
            </Card>

            <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
              <Button asChild variant="outline" size="lg">
                <Link to="/ingredients">Cancel</Link>
              </Button>
              <Button type="submit" variant="green" size="lg" disabled={save.isPending}>
                {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>

        {ingredient ? <IngredientStockPanel item={ingredient} canAdjust={canAdjust} title="Stock and cost" /> : null}
      </div>
    </PlainPage>
  );
}
