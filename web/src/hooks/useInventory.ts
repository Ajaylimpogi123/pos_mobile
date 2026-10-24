/**
 * Product inventory (Inventory (v1 completion)), ported from the tablet's
 * `mobile/src/hooks/inventory/useInventory.ts` and `useInventoryActions.ts`
 * (same rules and wording):
 * - the list (`GET /inventory`: status filter, category, search, cursor, the
 *   branch-wide `meta.summary`), the item (`GET /inventory/{product}`) and its
 *   history (`GET /inventory/{product}/movements`, type filter);
 * - the Stock in / Count / Wastage / Adjustment dialogs (`POST
 *   /admin/products/{id}/stock-adjustments`, idempotent: the ULID is kept until
 *   a 201 and a network error locks the body for Retry);
 * - the reorder level dialog (`PUT /inventory/{product}/reorder-level`).
 * After any write the item, its history, the lists, the admin products and
 * the Sell stock badges refresh.
 */
import { useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useCursorList } from '@/hooks/useCursorList';
import { useIdempotentRequest, type FieldMessages } from '@/hooks/useIdempotentRequest';
import { stockKey } from '@/hooks/useStockBadges';
import { getErrorMessage } from '@/services/api';
import { listAdminCategories, listCategories } from '@/services/catalog';
import { createStockAdjustment, getInventoryItem, listInventory, listInventoryMovements, setReorderLevel } from '@/services/inventory';
import type {
  Category,
  CursorPage,
  InventoryItem,
  InventoryPage,
  InventorySummary,
  StockAdjustmentRequest,
  StockMovement,
  StockMovementType,
  StockStatusFilter,
} from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { splitSaveError } from '@/utils/forms';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';
import { centsToInputText, parsePesoInput } from '@pos/core/money';
import { formatQty } from '@pos/core/quantity';

export const INVENTORY_PAGE_SIZE = 25;

/** Contract limits (Core Sale + Inventory). */
export const STOCK_LIMITS = { maxQty: 100_000, reasonMax: 255, maxUnitCostCents: 100_000_000, reorderMax: 100_000 } as const;

/** The status filter: All, Low, Out, and Low & out (`alerts`, the dashboard's link). */
export type InventorySegment = 'all' | 'low' | 'out' | 'alerts';

export const inventoryKeys = {
  all: ['inventory', 'products'] as const,
  lists: ['inventory', 'products', 'list'] as const,
  list: (search: string, categoryId: number | null, status: StockStatusFilter | null) =>
    ['inventory', 'products', 'list', search, categoryId, status] as const,
  item: (id: number) => ['inventory', 'products', 'item', id] as const,
  movements: (id: number) => ['inventory', 'products', 'movements', id] as const,
  movementList: (id: number, type: StockMovementType | null) => ['inventory', 'products', 'movements', id, type] as const,
  categories: (source: 'admin' | 'read') => ['inventory', 'categories', source] as const,
};

/** Who may read Inventory, write it, and open an order from the history. */
export function useInventoryPermissions() {
  const user = useSessionStore((state) => state.user);
  return {
    canRead: hasAnyPermission(user, [PERMISSIONS.inventoryAdjust, PERMISSIONS.reportView]),
    canAdjust: hasPermission(user, PERMISSIONS.inventoryAdjust),
    canOpenOrders: hasAnyPermission(user, [PERMISSIONS.saleCreate, PERMISSIONS.reportView]),
    canReadPurchasing: hasAnyPermission(user, [
      PERMISSIONS.purchaseRequest,
      PERMISSIONS.purchaseApprove,
      PERMISSIONS.purchaseApproveOwn,
      PERMISSIONS.purchaseReceive,
      PERMISSIONS.supplierManage,
      PERMISSIONS.reportView,
    ]),
    canManageProducts: hasPermission(user, PERMISSIONS.productManage),
  };
}

async function readAll(fetchPage: (cursor: string | undefined) => Promise<CursorPage<Category>>): Promise<Category[]> {
  const items: Category[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return items;
}

/**
 * The category filter: every category with `product.manage` (inventory
 * includes products of inactive categories), else the active ones from the
 * read endpoint.
 */
export function useInventoryCategories() {
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.productManage));
  const source = canManage ? 'admin' : 'read';
  const query = useQuery({
    queryKey: inventoryKeys.categories(source),
    queryFn: () =>
      readAll((cursor) => (canManage ? listAdminCategories({ cursor, per_page: 100 }) : listCategories({ cursor, per_page: 100 }))),
  });
  return { categories: query.data ?? [], loading: query.isPending, error: query.isError ? getErrorMessage(query.error) : null };
}

/** `GET /inventory` as a cursor list, plus its branch-wide summary. */
export function useInventoryList(search: string, categoryId: number | null, segment: InventorySegment) {
  const status: StockStatusFilter | null = segment === 'all' ? null : segment;
  const list = useCursorList<InventoryItem>(inventoryKeys.list(search, categoryId, status), (cursor) =>
    listInventory({
      cursor,
      per_page: INVENTORY_PAGE_SIZE,
      search: search || undefined,
      category_id: categoryId ?? undefined,
      status: status ?? undefined,
    }),
  );
  const summary: InventorySummary | null = (list.firstPage as InventoryPage | null)?.meta.summary ?? null;
  return { list, summary };
}

function cachedItem(client: QueryClient, productId: number): InventoryItem | undefined {
  for (const [, data] of client.getQueriesData<InfiniteData<InventoryPage>>({ queryKey: inventoryKeys.lists })) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((item) => item.product_id === productId);
      if (found) return found;
    }
  }
  return undefined;
}

/** `GET /inventory/{product}`, with the list's row as placeholder while it loads. */
export function useInventoryItem(productId: number | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: inventoryKeys.item(productId ?? -1),
    queryFn: () => getInventoryItem(productId as number),
    enabled: productId !== null,
    placeholderData: () => (productId === null ? undefined : cachedItem(client, productId)),
  });
  return {
    item: query.data ?? null,
    loading: productId !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** `GET /inventory/{product}/movements` with an optional type filter. */
export function useInventoryMovements(productId: number | null, type: StockMovementType | null) {
  return useCursorList(
    inventoryKeys.movementList(productId ?? -1, type),
    (cursor) => listInventoryMovements(productId as number, { cursor, per_page: INVENTORY_PAGE_SIZE, type: type ?? undefined }),
    { enabled: productId !== null },
  );
}

/** After any inventory write: the item, its history, the lists, the admin products and the Sell badges. */
export function useAfterInventoryWrite(productId: number) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: inventoryKeys.item(productId) });
    void client.invalidateQueries({ queryKey: inventoryKeys.movements(productId) });
    void client.invalidateQueries({ queryKey: inventoryKeys.lists });
    void client.invalidateQueries({ queryKey: ['admin', 'catalog', 'products'] });
    void client.invalidateQueries({ queryKey: stockKey });
  };
}

// ---------------------------------------------------------------------------
// Stock in / Count / Wastage / Adjustment
// ---------------------------------------------------------------------------

export type StockDialogKind = 'receipt' | 'count' | 'wastage' | 'adjustment';
export type AdjustDirection = 'add' | 'remove';
export type StockField = 'qty' | 'unitCost' | 'reason';

type StockFields = { qty: string; unitCost: string; reason: string; pick: string | null; direction: AdjustDirection };
type StockBody = StockAdjustmentRequest extends infer U ? (U extends unknown ? Omit<U, 'ulid'> : never) : never;

export const STOCK_UNCONFIRMED_MESSAGE = "We couldn't confirm the change. Retry.";

const API_FIELD: Record<string, StockField> = { qty_delta: 'qty', counted_qty: 'qty', unit_cost_cents: 'unitCost', reason: 'reason' };

function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Client-side checks mirroring the contract, then the body (without the ULID). */
export function validateStockDialog(kind: StockDialogKind, fields: StockFields): { body: StockBody | null; errors: FieldMessages<StockField> } {
  const errors: FieldMessages<StockField> = {};
  const qty = parseWhole(fields.qty);
  const max = formatQty(STOCK_LIMITS.maxQty);
  if (kind === 'count') {
    if (qty === null || qty > STOCK_LIMITS.maxQty) errors.qty = `Enter the counted quantity, a whole number from 0 to ${max}.`;
  } else if (qty === null || qty < 1 || qty > STOCK_LIMITS.maxQty) {
    errors.qty = `Enter a whole number from 1 to ${max}.`;
  }

  const typed = fields.reason.trim();
  let reason: string | null = typed === '' ? null : typed;
  if (kind === 'wastage') {
    if (fields.pick === null) errors.reason = 'Choose a reason.';
    else if (fields.pick !== 'other') reason = fields.pick;
    else if (typed === '') errors.reason = 'Enter a reason.';
  } else if (kind !== 'receipt' && typed === '') {
    errors.reason = 'Enter a reason.';
  }
  if (reason !== null && reason.length > STOCK_LIMITS.reasonMax) errors.reason = `Use ${STOCK_LIMITS.reasonMax} characters or fewer.`;

  let unitCost: number | undefined;
  if (kind === 'receipt' && fields.unitCost.trim() !== '') {
    const cents = parsePesoInput(fields.unitCost);
    if (cents === null || cents > STOCK_LIMITS.maxUnitCostCents) errors.unitCost = 'Enter a unit cost in pesos, e.g. 12.50.';
    else unitCost = cents;
  }

  if (qty === null || Object.keys(errors).length > 0) return { body: null, errors };
  switch (kind) {
    case 'receipt':
      return { body: { type: 'receipt', qty_delta: qty, reason, ...(unitCost === undefined ? {} : { unit_cost_cents: unitCost }) }, errors };
    case 'count':
      return { body: { type: 'count', counted_qty: qty, reason: reason ?? '' }, errors };
    case 'wastage':
      return { body: { type: 'wastage', qty_delta: -qty, reason: reason ?? '' }, errors };
    default:
      return { body: { type: 'adjustment', qty_delta: fields.direction === 'remove' ? -qty : qty, reason: reason ?? '' }, errors };
  }
}

/** What changed, for the success toast. */
export function stockNotice(kind: StockDialogKind, name: string, movement: StockMovement): string {
  const onHand = `${formatQty(movement.qty_after)} on hand`;
  if (kind === 'receipt') return `Received ${formatQty(movement.qty_delta)} “${name}”. ${onHand}.`;
  if (kind === 'wastage') return `Wasted ${formatQty(Math.abs(movement.qty_delta))} “${name}”. ${onHand}.`;
  if (kind === 'adjustment') return `${movement.qty_delta > 0 ? 'Added' : 'Removed'} ${formatQty(Math.abs(movement.qty_delta))} “${name}”. ${onHand}.`;
  return `Counted “${name}”: ${formatQty(movement.qty_before)} → ${formatQty(movement.qty_after)}.`;
}

/**
 * One stock dialog (`inventory.adjust`). Each kind keeps its own pending ULID,
 * so a retry after a timeout can't write twice.
 */
export function useStockDialog(item: InventoryItem | null, kind: StockDialogKind, onApplied: (notice: string) => void) {
  const productId = item?.product_id ?? -1;
  const afterWrite = useAfterInventoryWrite(productId);
  const request = useIdempotentRequest<StockBody, StockMovement, StockField>({
    request: (key, body) => createStockAdjustment(productId, { ulid: key, ...body } as StockAdjustmentRequest),
    fieldOf: (field) => API_FIELD[field] ?? null,
    unconfirmedMessage: STOCK_UNCONFIRMED_MESSAGE,
  });
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<StockFields>({ qty: '', unitCost: '', reason: '', pick: null, direction: 'add' });
  const [localErrors, setLocalErrors] = useState<FieldMessages<StockField>>({});

  function show() {
    if (!item) return;
    request.clearMessages();
    setLocalErrors({});
    // A pending ULID: the last attempt didn't succeed, so keep what was typed for the retry.
    if (!request.hasPending()) {
      setFields({ qty: '', unitCost: kind === 'receipt' ? centsToInputText(item.cost_cents) : '', reason: '', pick: null, direction: 'add' });
    }
    setOpen(true);
  }

  async function submit() {
    if (!item || request.isInFlight()) return;
    let body: StockBody | null = null;
    if (!request.unconfirmed) {
      const checked = validateStockDialog(kind, fields);
      setLocalErrors(checked.errors);
      request.clearMessages();
      if (!checked.body) return;
      body = checked.body;
    }
    const movement = await request.send(body);
    if (!movement) return;
    setOpen(false);
    afterWrite();
    onApplied(stockNotice(kind, item.name, movement));
  }

  function edit(patch: Partial<StockFields>, field: StockField) {
    if (request.unconfirmed) return;
    setFields((current) => ({ ...current, ...patch }));
    setLocalErrors((current) => ({ ...current, [field]: undefined }));
    request.clearField(field);
  }

  return {
    kind,
    open,
    show,
    close: () => {
      if (!request.isInFlight()) setOpen(false);
    },
    fields,
    setQty: (text: string) => edit({ qty: text.replace(/[^0-9]/g, '') }, 'qty'),
    setUnitCost: (text: string) => edit({ unitCost: text }, 'unitCost'),
    setReason: (text: string) => edit({ reason: text }, 'reason'),
    setPick: (pick: string) => edit({ pick }, 'reason'),
    setDirection: (direction: AdjustDirection) => edit({ direction }, 'qty'),
    errors: {
      qty: localErrors.qty ?? request.fieldErrors.qty,
      unitCost: localErrors.unitCost ?? request.fieldErrors.unitCost,
      reason: localErrors.reason ?? request.fieldErrors.reason,
    } as FieldMessages<StockField>,
    banner: request.banner,
    busy: request.busy,
    /** No answer to the last attempt: the fields are locked and the confirm button retries. */
    locked: request.unconfirmed,
    submit: () => void submit(),
  };
}

export type StockDialogState = ReturnType<typeof useStockDialog>;

// ---------------------------------------------------------------------------
// Reorder level
// ---------------------------------------------------------------------------

/** The reorder level dialog: a whole number 0–100000 (Save) or **Remove** (`null`). */
export function useReorderLevelDialog(item: InventoryItem | null, onSaved: (notice: string) => void) {
  const client = useQueryClient();
  const productId = item?.product_id ?? -1;
  const afterWrite = useAfterInventoryWrite(productId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);

  async function send(level: number | null) {
    if (!item || busy) return;
    setBusy(level === null ? 'remove' : 'save');
    setBanner(null);
    try {
      const updated = await setReorderLevel(item.product_id, { reorder_level: level });
      client.setQueryData(inventoryKeys.item(item.product_id), updated);
      setOpen(false);
      afterWrite();
      onSaved(level === null ? `Removed the reorder level of “${item.name}”.` : `Reorder level of “${item.name}” set to ${formatQty(level)}.`);
    } catch (failure) {
      const split = splitSaveError(failure, ['reorder_level']);
      setError(split.fieldErrors.reorder_level ?? null);
      setBanner(split.banner);
    } finally {
      setBusy(null);
    }
  }

  return {
    open,
    show: () => {
      if (!item) return;
      setText(item.reorder_level === null ? '' : String(item.reorder_level));
      setError(null);
      setBanner(null);
      setOpen(true);
    },
    close: () => {
      if (!busy) setOpen(false);
    },
    text,
    setText: (value: string) => {
      setText(value.replace(/[^0-9]/g, ''));
      setError(null);
    },
    error,
    banner,
    busy,
    canRemove: item !== null && item.reorder_level !== null,
    save: () => {
      const level = parseWhole(text);
      if (level === null || level > STOCK_LIMITS.reorderMax) {
        setError(`Enter a whole number from 0 to ${formatQty(STOCK_LIMITS.reorderMax)}.`);
        return;
      }
      void send(level);
    },
    remove: () => void send(null),
  };
}

export type ReorderLevelDialogState = ReturnType<typeof useReorderLevelDialog>;
