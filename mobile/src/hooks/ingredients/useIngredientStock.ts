import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { queryKeys as dashboardKeys } from '@/hooks/dashboard/queryKeys';
import { splitSaveError, type FieldErrors } from '@/hooks/forms/formErrors';
import { useIdempotentRequest } from '@/hooks/forms/useIdempotentRequest';
import type { InventorySegment } from '@/hooks/inventory/useInventory';
import { ingredientKeys, ingredientStockKeys } from '@/hooks/purchasing/queryKeys';
import { useUnits } from '@/hooks/units/useUnits';
import { useKeyedCursorList } from '@/hooks/useCursorList';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsOnline } from '@/hooks/useIsOnline';
import {
  createIngredientStockAdjustment,
  getIngredientInventoryItem,
  listIngredientInventory,
  listIngredientMovements,
  setIngredientReorderLevel,
} from '@/services/ingredients';
import type {
  Ingredient,
  IngredientInventoryPage,
  IngredientMovement,
  IngredientStockAdjustmentRequest,
  IngredientStockAdjustmentResult,
  IngredientStockAdjustmentType,
  InventorySummary,
  IngredientMovementType,
  StockStatusFilter,
} from '@/services/types';
import { formatQtyUnit, parseQtyInput, qtyProblemMessage } from '@/utils/quantity';
import { ingredientUnitChoices, type UnitChoices } from '@/utils/units';

/** Ingredients per page on the stock list and the history. */
export const INGREDIENT_STOCK_PAGE_SIZE = 25;

/** Stock ops reason limit (as products). */
export const REASON_MAX = 255;

function ingredientKey(item: Ingredient): number {
  return item.id;
}

function movementKey(movement: IngredientMovement): string {
  return movement.ulid;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Inventory → Ingredients (`/inventory/ingredients`): the segmented status
 * filter (`?status=alerts` from the dashboard opens Low & out), the pill
 * search, and the cursor list with its branch-wide `meta.summary`.
 */
export function useIngredientStockListScreen() {
  const params = useLocalSearchParams<{ status?: string | string[] }>();
  const fromAlerts = firstParam(params.status) === 'alerts';
  const [segment, setSegment] = useState<InventorySegment>(fromAlerts ? 'alerts' : 'all');
  const [search, setSearch] = useState('');
  const online = useIsOnline();
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const status: StockStatusFilter | null = segment === 'all' ? null : segment;

  const list = useKeyedCursorList<Ingredient>({
    queryKey: ingredientStockKeys.list({ search: debounced, status }),
    fetchPage: (cursor) =>
      listIngredientInventory({
        per_page: INGREDIENT_STOCK_PAGE_SIZE,
        cursor,
        search: debounced === '' ? undefined : debounced,
        status: status ?? undefined,
      }),
    keepPrevious: true,
    enabled: online,
    keyOf: ingredientKey,
  });

  const firstPage = list.data?.pages[0] as IngredientInventoryPage | undefined;
  const summary: InventorySummary | null = firstPage?.meta.summary ?? null;

  return {
    online,
    segment,
    setSegment,
    showAlertsSegment: fromAlerts,
    search,
    setSearch,
    searching: search.trim() !== debounced || list.grid.updating,
    filtersActive: debounced !== '' || segment !== 'all',
    clearFilters: () => {
      setSearch('');
      setSegment('all');
    },
    summary,
    list,
  };
}

/** The ingredient as the stock list already holds it (shown at once while the fresh copy loads). */
function cachedIngredient(client: QueryClient, id: number): Ingredient | undefined {
  const lists = client.getQueriesData<InfiniteData<IngredientInventoryPage>>({ queryKey: ingredientStockKeys.lists() });
  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((item) => item.id === id);
      if (found) return found;
    }
  }
  return undefined;
}

/** GET /inventory/ingredients/{id}, with the list's card as placeholder data. */
export function useIngredientStockItem(id: number | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ingredientStockKeys.item(id ?? -1),
    queryFn: () => getIngredientInventoryItem(id as number),
    enabled: id !== null,
    placeholderData: () => (id === null ? undefined : cachedIngredient(client, id)),
  });
}

/** GET /inventory/ingredients/{id}/movements with an optional type filter. */
export function useIngredientMovements(id: number | null, type: IngredientMovementType | null) {
  return useKeyedCursorList<IngredientMovement>({
    queryKey: ingredientStockKeys.movementList(id ?? -1, type),
    fetchPage: (cursor) =>
      listIngredientMovements(id as number, { per_page: INGREDIENT_STOCK_PAGE_SIZE, cursor, type: type ?? undefined }),
    keepPrevious: true,
    enabled: id !== null,
    keyOf: movementKey,
  });
}

/** The valid units of an ingredient (§A), from the catalog once it loads. */
export function useIngredientUnitChoices(ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null): UnitChoices | null {
  const { units } = useUnits(ingredient !== null);
  return useMemo(() => (ingredient ? ingredientUnitChoices(ingredient, units) : null), [ingredient, units]);
}

/** After any ingredient stock write: its stock, history, the lists, its admin copy and the dashboard alerts refresh. */
export function useAfterIngredientStockWrite(id: number) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ingredientStockKeys.item(id) });
    void client.invalidateQueries({ queryKey: ingredientStockKeys.movements(id) });
    void client.invalidateQueries({ queryKey: ingredientStockKeys.lists() });
    void client.invalidateQueries({ queryKey: ingredientKeys.lists() });
    void client.invalidateQueries({ queryKey: dashboardKeys.dashboard });
  };
}

// ---------------------------------------------------------------------------
// Adjust / Count / Wastage (inventory.adjust)
// ---------------------------------------------------------------------------

/** The three ingredient stock dialogs. */
export type IngredientStockDialogKind = IngredientStockAdjustmentType;

/** Add or remove, for an adjustment (its `qty` is signed). */
export type AdjustDirection = 'add' | 'remove';

export type IngredientStockField = 'qty' | 'unit' | 'reason';

type StockBody = Omit<IngredientStockAdjustmentRequest, 'ulid'>;

type DialogFields = { qty: string; unit: string; direction: AdjustDirection; reason: string; pick: string | null };

/** Wastage quick picks (as products; `other` shows a text field). */
export const INGREDIENT_WASTAGE_PICKS: readonly { value: string; label: string }[] = [
  { value: 'Spoiled', label: 'Spoiled' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Damaged', label: 'Damaged' },
  { value: 'other', label: 'Other…' },
];

const STOCK_FIELD_OF: Record<string, IngredientStockField> = { qty: 'qty', unit: 'unit', reason: 'reason' };

function stockFieldOf(apiField: string): IngredientStockField | null {
  return STOCK_FIELD_OF[apiField] ?? null;
}

export const INGREDIENT_STOCK_UNCONFIRMED_MESSAGE = "We couldn't confirm the change. Retry.";

/**
 * Client-side checks (§A quantities; a reason for every type), then the body
 * without its ULID. Q-026: `adjustment` sends a signed `qty`, `count`
 * the counted quantity (≥ 0), `wastage` a negative `qty` (as products).
 */
export function validateIngredientStock(
  kind: IngredientStockDialogKind,
  fields: DialogFields,
  choices: UnitChoices,
): { body: StockBody | null; errors: FieldErrors<IngredientStockField> } {
  const errors: FieldErrors<IngredientStockField> = {};
  const allowZero = kind === 'count';
  const qty = parseQtyInput(fields.qty, { allowZero });
  if (!qty.ok) errors.qty = qtyProblemMessage(qty.problem, { allowZero });
  const validUnit = [...choices.own, ...choices.catalog].some((option) => option.code === fields.unit);
  if (!validUnit) errors.unit = 'Choose a unit.';

  let reason = fields.reason.trim();
  if (kind === 'wastage' && fields.pick !== null && fields.pick !== 'other') reason = fields.pick;
  if (kind === 'wastage' && fields.pick === null) errors.reason = 'Choose a reason.';
  else if (reason === '') errors.reason = 'Enter a reason.';
  else if (reason.length > REASON_MAX) errors.reason = `Use ${REASON_MAX} characters or fewer.`;

  if (!qty.ok || Object.keys(errors).length > 0) return { body: null, errors };
  const negative = kind === 'wastage' || (kind === 'adjustment' && fields.direction === 'remove');
  return { body: { type: kind, qty: negative ? `-${qty.value}` : qty.value, unit: fields.unit, reason }, errors };
}

/**
 * One of the ingredient Adjust / Count / Wastage dialogs, on the shared
 * idempotent core: its ULID is kept until a 201; a network error locks the
 * body and the button becomes **Retry**; 422s go under `qty`, `unit`, `reason`.
 */
export function useIngredientStockDialog(item: Ingredient | null, kind: IngredientStockDialogKind, onApplied: (notice: string) => void) {
  const id = item?.id ?? -1;
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientStockWrite(id);
  const request = useIdempotentRequest<StockBody, IngredientStockAdjustmentResult, IngredientStockField>({
    request: (key, body) => createIngredientStockAdjustment(id, { ulid: key, ...body }),
    fieldOf: stockFieldOf,
    unconfirmedMessage: INGREDIENT_STOCK_UNCONFIRMED_MESSAGE,
  });
  const [visible, setVisible] = useState(false);
  const [fields, setFields] = useState<DialogFields>({ qty: '', unit: '', direction: 'add', reason: '', pick: null });
  const [localErrors, setLocalErrors] = useState<FieldErrors<IngredientStockField>>({});

  function open() {
    if (!item) return;
    request.clearMessages();
    setLocalErrors({});
    // A pending ULID: the last attempt didn't succeed, so keep what was typed for the retry.
    if (!request.hasPending()) setFields({ qty: '', unit: item.base_unit, direction: 'add', reason: '', pick: null });
    setVisible(true);
  }

  async function submit() {
    if (!item || !choices || request.isInFlight()) return;
    let body: StockBody | null = null;
    if (!request.unconfirmed) {
      const checked = validateIngredientStock(kind, fields, choices);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
    }
    const result = await request.send(body);
    if (result === null) return;
    setVisible(false);
    afterWrite();
    const entered = formatQtyUnit(fields.qty, fields.unit);
    // Q-026: the 201 carries `qty_before` / `qty_after` in base units (the server's figures).
    const before = formatQtyUnit(result.qty_before, item.base_unit);
    const onHand = `${formatQtyUnit(result.qty_after, item.base_unit)} on hand`;
    if (kind === 'count') onApplied(`Counted “${item.name}”: ${before} → ${onHand}.`);
    else if (kind === 'wastage') onApplied(`Wasted ${entered} of “${item.name}”. ${onHand}.`);
    else onApplied(`${fields.direction === 'add' ? 'Added' : 'Removed'} ${entered} of “${item.name}”. ${onHand}.`);
  }

  function edit(patch: Partial<DialogFields>, field: IngredientStockField) {
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  return {
    kind,
    visible,
    open,
    cancel: () => {
      if (!request.isInFlight()) setVisible(false);
    },
    choices,
    fields,
    setQty: (text: string) => edit({ qty: text }, 'qty'),
    setUnit: (unit: string) => edit({ unit }, 'unit'),
    setDirection: (direction: AdjustDirection) => edit({ direction }, 'qty'),
    setReason: (text: string) => edit({ reason: text }, 'reason'),
    setPick: (pick: string) => edit({ pick }, 'reason'),
    errors: {
      qty: localErrors.qty ?? request.fieldErrors.qty,
      unit: localErrors.unit ?? request.fieldErrors.unit,
      reason: localErrors.reason ?? request.fieldErrors.reason,
    } as FieldErrors<IngredientStockField>,
    banner: request.banner,
    busy: request.busy,
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type IngredientStockDialogState = ReturnType<typeof useIngredientStockDialog>;

// ---------------------------------------------------------------------------
// Reorder level
// ---------------------------------------------------------------------------

/**
 * The ingredient reorder level dialog (`inventory.adjust`): a quantity in any
 * valid unit (Save) or **Remove** (`null`). `PUT …/reorder-level` answers with
 * the updated ingredient (Q-026: `{ reorder_level: {qty, unit} | null }`).
 */
export function useIngredientReorderDialog(item: Ingredient | null, onSaved: (notice: string) => void) {
  const client = useQueryClient();
  const id = item?.id ?? -1;
  const choices = useIngredientUnitChoices(item);
  const afterWrite = useAfterIngredientStockWrite(id);
  const [visible, setVisible] = useState(false);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [errors, setErrors] = useState<{ qty?: string; unit?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  function open() {
    if (!item) return;
    setQty(item.reorder_level === null ? '' : formatPlain(item.reorder_level));
    setUnit(item.base_unit);
    setErrors({});
    setBanner(null);
    setVisible(true);
  }

  async function send(level: { qty: string; unit: string } | null) {
    if (!item || busy) return;
    setBusy(level === null ? 'remove' : 'save');
    setBanner(null);
    try {
      const updated = await setIngredientReorderLevel(item.id, { reorder_level: level });
      client.setQueryData(ingredientStockKeys.item(item.id), updated);
      setVisible(false);
      afterWrite();
      onSaved(
        level === null
          ? `Removed the reorder level of “${item.name}”.`
          : `Reorder level of “${item.name}” set to ${formatQtyUnit(level.qty, level.unit)}.`,
      );
    } catch (failure) {
      const split = splitSaveError(failure, ['reorder_level', 'reorder_level.qty', 'reorder_level.unit'] as const);
      setErrors({
        qty: split.fieldErrors['reorder_level.qty'] ?? split.fieldErrors.reorder_level,
        unit: split.fieldErrors['reorder_level.unit'],
      });
      setBanner(split.banner);
    } finally {
      setBusy(null);
    }
  }

  function save() {
    const parsed = parseQtyInput(qty, { allowZero: true });
    if (!parsed.ok) {
      setErrors({ qty: qtyProblemMessage(parsed.problem, { allowZero: true }) });
      return;
    }
    void send({ qty: parsed.value, unit });
  }

  return {
    visible,
    open,
    cancel: () => {
      if (!busy) setVisible(false);
    },
    choices,
    qty,
    setQty: (text: string) => {
      setQty(text);
      setErrors((current) => ({ ...current, qty: undefined }));
    },
    unit,
    setUnit: (code: string) => {
      setUnit(code);
      setErrors((current) => ({ ...current, unit: undefined }));
    },
    errors,
    banner,
    busy,
    canRemove: item !== null && item.reorder_level !== null,
    save,
    remove: () => void send(null),
  };
}

/** A stored level as editable text (`"5000.000"` → `"5000"`). */
function formatPlain(value: string | number): string {
  const parsed = parseQtyInput(String(value), { allowZero: true, allowNegative: true });
  return parsed.ok ? parsed.value : String(value);
}

export type IngredientReorderDialogState = ReturnType<typeof useIngredientReorderDialog>;
