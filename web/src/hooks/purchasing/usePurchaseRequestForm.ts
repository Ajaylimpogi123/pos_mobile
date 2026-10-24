/**
 * Create / edit a purchase request (§F, §L; Q-027, Q-030), ported from the
 * tablet's `mobile/src/hooks/purchasing/usePurchaseRequestForm.ts`:
 * - **Create** (`purchase.request`): POST, idempotent by its own ULID kept
 *   until the 201; after a network error or a timeout the body locks and Save
 *   becomes **Retry** with the same body.
 * - **Edit** (while no item is decided): PATCH with the items by `id` (new
 *   rows have none; removed rows are left out). A 409 ("This request is
 *   already being reviewed.") shows in the banner.
 * - Items: an active ingredient (§L picker), a supplier, a quantity (> 0,
 *   ≤ 3 decimals; a product item whole) in a valid unit, an optional
 *   estimated price per unit and remarks. 422s go under their row's field
 *   (`items.3.qty`); anything else is a banner.
 */
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { purchaseRequestKeys, useAfterPurchasingWrite } from '@/hooks/purchasing/usePurchasingPermissions';
import { useIdempotentRequest } from '@/hooks/useIdempotentRequest';
import { ingredientKeys } from '@/hooks/useIngredients';
import { useUnits } from '@/hooks/useRecipeBuilder';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { getAdminIngredient } from '@/services/ingredients';
import { createPurchaseRequest, updatePurchaseRequest } from '@/services/purchasing';
import type {
  BusinessDate,
  Ingredient,
  PurchaseItemType,
  PurchaseRequest,
  PurchaseRequestCreateRequest,
  PurchaseRequestItemRequest,
  SupplierRef,
  Unit,
} from '@/services/types';
import { centsToInputText, parsePesoInput } from '@pos/core/money';
import { isWholeQty, parseQtyInput, PRODUCT_WHOLE_MESSAGE, qtyProblemMessage } from '@pos/core/quantity';
import { findUnit, itemUnitChoices, type UnitChoices } from '@pos/core/units';

/** §F: 1..100 items. Q-030: PR remarks max 500; item remarks max 255. */
export const PR_LIMITS = { items: 100, remarks: 500, itemRemarks: 255, priceMaxCents: 100_000_000 } as const;

export const PR_UNCONFIRMED_MESSAGE = "We couldn't confirm the request was saved. Retry.";

export type PrItemDraft = {
  key: string;
  id?: number;
  type: PurchaseItemType | null;
  itemId: number | null;
  name: string;
  /** The picked ingredient (its units); `null` for a product, or while an edited item's ingredient loads. */
  ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null;
  supplier: SupplierRef | null;
  qty: string;
  unit: string;
  /** Estimated price per entered unit, in pesos (optional). */
  price: string;
  remarks: string;
};

export type PrFormValues = { dateNeeded: string; remarks: string; items: PrItemDraft[] };

/** `date_needed`, `remarks`, `items`, and `items.<i>.<field>` (the API's keys). */
export type PrFieldErrors = Record<string, string | undefined>;

/** A picked item (the picker offers active ingredients only, §L). */
export type PurchaseItemOption = { type: PurchaseItemType; id: number; name: string; ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null };

let draftSequence = 0;
function newDraftKey(): string {
  draftSequence += 1;
  return `pr-item-${draftSequence}`;
}

function emptyDraft(): PrItemDraft {
  return { key: newDraftKey(), type: null, itemId: null, name: '', ingredient: null, supplier: null, qty: '', unit: '', price: '', remarks: '' };
}

function qtyText(value: string | number): string {
  const parsed = parseQtyInput(String(value), { allowNegative: true, allowZero: true });
  return parsed.ok ? parsed.value : String(value);
}

function prToValues(pr: PurchaseRequest | null): PrFormValues {
  if (!pr) return { dateNeeded: '', remarks: '', items: [emptyDraft()] };
  return {
    dateNeeded: pr.date_needed ?? '',
    remarks: pr.remarks ?? '',
    items: pr.items.map((item) => ({
      key: newDraftKey(),
      id: item.id,
      type: item.item.type,
      itemId: item.item.id,
      name: item.item.name,
      ingredient: null,
      supplier: item.supplier,
      qty: qtyText(item.qty),
      unit: item.unit,
      price: item.estimated_unit_price_cents === null ? '' : centsToInputText(item.estimated_unit_price_cents),
      remarks: item.remarks ?? '',
    })),
  };
}

/** The units a row may use: the picked item's valid units (§A); only its current unit while an ingredient loads. */
function draftUnitChoices(draft: PrItemDraft, ingredient: Pick<Ingredient, 'base_unit' | 'units'> | null, catalog: readonly Unit[]): UnitChoices | null {
  if (draft.type === null) return null;
  if (draft.type === 'product') return itemUnitChoices('product', null, catalog);
  if (ingredient) return itemUnitChoices('ingredient', ingredient, catalog);
  if (draft.unit === '') return null;
  return { baseUnit: draft.unit, own: [], catalog: [{ code: draft.unit, name: draft.unit, factor: '1', group: 'catalog' }] };
}

function validatePr(values: PrFormValues, choicesOf: (draft: PrItemDraft) => UnitChoices | null): {
  body: Omit<PurchaseRequestCreateRequest, 'ulid'> | null;
  errors: PrFieldErrors;
} {
  const errors: PrFieldErrors = {};
  if (values.items.length === 0) errors.items = 'Add at least one item.';
  if (values.items.length > PR_LIMITS.items) errors.items = `Use at most ${PR_LIMITS.items} items.`;
  const remarks = values.remarks.trim();
  if (remarks.length > PR_LIMITS.remarks) errors.remarks = `Use ${PR_LIMITS.remarks} characters or fewer.`;
  const dateNeeded = values.dateNeeded.trim();
  if (dateNeeded !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) errors.date_needed = 'Enter a date.';

  const items: PurchaseRequestItemRequest[] = [];
  values.items.forEach((draft, index) => {
    const at = `items.${index}`;
    if (draft.type === null || draft.itemId === null) errors[`${at}.item_id`] = 'Choose an item.';
    if (draft.supplier === null) errors[`${at}.supplier_id`] = 'Choose a supplier.';
    const qty = parseQtyInput(draft.qty);
    if (!qty.ok) errors[`${at}.qty`] = qtyProblemMessage(qty.problem);
    else if (draft.type === 'product' && !isWholeQty(qty.value)) errors[`${at}.qty`] = PRODUCT_WHOLE_MESSAGE;
    const choices = choicesOf(draft);
    if (draft.type !== null && (!choices || !findUnit(choices, draft.unit))) errors[`${at}.unit`] = 'Choose a unit.';
    let price: number | null = null;
    if (draft.price.trim() !== '') {
      price = parsePesoInput(draft.price);
      if (price === null || price > PR_LIMITS.priceMaxCents) errors[`${at}.estimated_unit_price_cents`] = 'Enter a price in pesos, e.g. 1200.00.';
    }
    const itemRemarks = draft.remarks.trim();
    if (itemRemarks.length > PR_LIMITS.itemRemarks) errors[`${at}.remarks`] = `Use ${PR_LIMITS.itemRemarks} characters or fewer.`;
    if (draft.type !== null && draft.itemId !== null && draft.supplier && qty.ok) {
      items.push({
        ...(draft.id === undefined ? {} : { id: draft.id }),
        item_type: draft.type,
        item_id: draft.itemId,
        supplier_id: draft.supplier.id,
        qty: qty.value,
        unit: draft.unit,
        estimated_unit_price_cents: price,
        remarks: itemRemarks === '' ? null : itemRemarks,
      });
    }
  });

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { date_needed: dateNeeded === '' ? null : (dateNeeded as BusinessDate), remarks: remarks === '' ? null : remarks, items }, errors };
}

/** The 422 keys the form shows under a field (everything else goes to the banner). */
function isFormField(field: string): boolean {
  return field === 'date_needed' || field === 'remarks' || field === 'items' || /^items\.\d+\.[a-z_]+$/.test(field);
}

export function usePurchaseRequestForm({ initial, onSaved }: { initial: PurchaseRequest | null; onSaved: (pr: PurchaseRequest) => void }) {
  const client = useQueryClient();
  const afterWrite = useAfterPurchasingWrite();
  const { units: catalog } = useUnits();
  const [values, setValues] = useState<PrFormValues>(() => prToValues(initial));
  const [localErrors, setLocalErrors] = useState<PrFieldErrors>({});
  const [editBanner, setEditBanner] = useState<string | null>(null);
  const [editErrors, setEditErrors] = useState<PrFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const isEdit = initial !== null;

  const create = useIdempotentRequest<Omit<PurchaseRequestCreateRequest, 'ulid'>, PurchaseRequest, string>({
    request: (key, body) => createPurchaseRequest({ ulid: key, ...body }),
    fieldOf: (field) => (isFormField(field) ? field : null),
    unconfirmedMessage: PR_UNCONFIRMED_MESSAGE,
  });

  // An edited PR's ingredient items need their units (GET /admin/ingredients/{id}).
  const ingredientIds = useMemo(
    () => [
      ...new Set(
        values.items.filter((item) => item.type === 'ingredient' && item.ingredient === null && item.itemId !== null).map((item) => item.itemId as number),
      ),
    ],
    [values.items],
  );
  const loaded = useQueries({
    queries: ingredientIds.map((id) => ({ queryKey: ingredientKeys.detail(id), queryFn: () => getAdminIngredient(id) })),
  });
  const loadedById = new Map<number, Ingredient>();
  loaded.forEach((result, index) => {
    const id = ingredientIds[index];
    if (result.data && id !== undefined) loadedById.set(id, result.data);
  });

  function choicesOf(draft: PrItemDraft): UnitChoices | null {
    const ingredient = draft.ingredient ?? (draft.itemId !== null ? (loadedById.get(draft.itemId) ?? null) : null);
    return draftUnitChoices(draft, ingredient, catalog);
  }

  const locked = create.unconfirmed;
  const busy = saving || create.busy;

  function clearErrors(keys: string[]) {
    const strip = (current: PrFieldErrors) => {
      if (!keys.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    };
    setLocalErrors(strip);
    setEditErrors(strip);
    for (const key of keys) create.clearField(key);
  }

  function updateItem(index: number, patch: Partial<PrItemDraft>, fields: string[]) {
    if (locked) return;
    setValues((current) => ({ ...current, items: current.items.map((item, at) => (at === index ? { ...item, ...patch } : item)) }));
    clearErrors(fields.map((field) => `items.${index}.${field}`));
  }

  async function submit() {
    if (inFlight.current || busy) return;
    setEditBanner(null);
    let body: Omit<PurchaseRequestCreateRequest, 'ulid'> | null = null;
    if (!create.unconfirmed) {
      const checked = validatePr(values, choicesOf);
      setLocalErrors(checked.errors);
      create.clearMessages();
      setEditErrors({});
      if (!checked.body) return;
      body = checked.body;
    }

    if (!isEdit) {
      const created = await create.send(body);
      if (!created) return;
      client.setQueryData(purchaseRequestKeys.detail(created.ulid), created);
      afterWrite();
      onSaved(created);
      return;
    }

    if (!body || !initial) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const updated = await updatePurchaseRequest(initial.ulid, { date_needed: body.date_needed, remarks: body.remarks, items: body.items });
      client.setQueryData(purchaseRequestKeys.detail(updated.ulid), updated);
      afterWrite();
      onSaved(updated);
    } catch (error) {
      if (isApiValidationError(error)) {
        const shown: PrFieldErrors = {};
        for (const [field, messages] of Object.entries(error.errors)) if (messages[0] && isFormField(field)) shown[field] = messages[0];
        setEditErrors(shown);
        if (Object.keys(shown).length === 0) setEditBanner(error.message);
      } else {
        setEditBanner(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const errors: PrFieldErrors = { ...create.fieldErrors, ...editErrors, ...localErrors };

  return {
    isEdit,
    values,
    errors,
    banner: isEdit ? editBanner : create.banner,
    busy,
    locked,
    choicesOf,
    full: values.items.length >= PR_LIMITS.items,
    setDateNeeded: (date: string) => {
      if (locked) return;
      setValues((current) => ({ ...current, dateNeeded: date }));
      clearErrors(['date_needed']);
    },
    setRemarks: (remarks: string) => {
      if (locked) return;
      setValues((current) => ({ ...current, remarks }));
      clearErrors(['remarks']);
    },
    addItem: () => {
      if (locked || values.items.length >= PR_LIMITS.items) return;
      setValues((current) => ({ ...current, items: [...current.items, emptyDraft()] }));
      clearErrors(['items']);
    },
    removeItem: (key: string) => {
      if (locked) return;
      setValues((current) => ({ ...current, items: current.items.filter((item) => item.key !== key) }));
      // Row indices shift: drop every row error rather than show one under the wrong row.
      clearErrors(Object.keys(errors).filter((field) => field.startsWith('items.')));
    },
    pickItem: (index: number, option: PurchaseItemOption) =>
      updateItem(
        index,
        { type: option.type, itemId: option.id, name: option.name, ingredient: option.ingredient, unit: option.ingredient ? option.ingredient.base_unit : 'pc' },
        ['item_id', 'item_type', 'unit'],
      ),
    pickSupplier: (index: number, supplier: SupplierRef) => updateItem(index, { supplier }, ['supplier_id']),
    setQty: (index: number, qty: string) => updateItem(index, { qty }, ['qty']),
    setUnit: (index: number, unit: string) => updateItem(index, { unit }, ['unit']),
    setPrice: (index: number, price: string) => updateItem(index, { price }, ['estimated_unit_price_cents']),
    setItemRemarks: (index: number, remarks: string) => updateItem(index, { remarks }, ['remarks']),
    submit: () => void submit(),
  };
}

export type PurchaseRequestFormState = ReturnType<typeof usePurchaseRequestForm>;
