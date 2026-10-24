import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { groupByArea } from '@/components/tables/tableLabels';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { useCursorList } from '@/hooks/useCursorList';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { createTable, deleteTable, listAdminTables, updateTable } from '@/services/tables';
import type { DiningTable, DiningTableCreateRequest } from '@/services/types';
import { showToast } from '@/stores/toast';

/** Contract §B rules (the server checks them too). */
export const TABLE_LIMITS = { nameMax: 10, areaMax: 30, seatsMin: 1, seatsMax: 50, sortMax: 9999 } as const;
const NAME_PATTERN = /^[A-Za-z0-9 -]+$/;

export type TableDraft = {
  /** `null`: a new table. */
  id: number | null;
  name: string;
  area: string;
  seats: string;
  sortOrder: string;
  isActive: boolean;
};

export type TableDraftErrors = Partial<Record<'name' | 'area' | 'seats' | 'sortOrder' | 'isActive', string>>;

const FIELD_OF: Record<string, keyof TableDraftErrors> = {
  name: 'name',
  area: 'area',
  seats: 'seats',
  sort_order: 'sortOrder',
  is_active: 'isActive',
};

function draftOf(table: DiningTable | null): TableDraft {
  return {
    id: table?.id ?? null,
    name: table?.name ?? '',
    area: table?.area ?? '',
    seats: table ? String(table.seats) : '4',
    sortOrder: table ? String(table.sort_order) : '0',
    isActive: table?.is_active ?? true,
  };
}

function wholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** The client-side checks of §B, and the body (`null` with errors). */
export function checkTableDraft(draft: TableDraft): { body: DiningTableCreateRequest | null; errors: TableDraftErrors } {
  const errors: TableDraftErrors = {};
  const name = draft.name.trim();
  if (name === '') errors.name = 'Enter the table name.';
  else if (name.length > TABLE_LIMITS.nameMax) errors.name = `Use ${TABLE_LIMITS.nameMax} characters or fewer.`;
  else if (!NAME_PATTERN.test(name)) errors.name = 'Use letters, numbers, spaces and hyphens only.';
  const area = draft.area.trim();
  if (area.length > TABLE_LIMITS.areaMax) errors.area = `Use ${TABLE_LIMITS.areaMax} characters or fewer.`;
  const seats = wholeNumber(draft.seats, TABLE_LIMITS.seatsMin, TABLE_LIMITS.seatsMax);
  if (seats === null) errors.seats = `Enter ${TABLE_LIMITS.seatsMin} to ${TABLE_LIMITS.seatsMax} seats.`;
  const sortOrder = draft.sortOrder.trim() === '' ? 0 : wholeNumber(draft.sortOrder, 0, TABLE_LIMITS.sortMax);
  if (sortOrder === null) errors.sortOrder = `Enter 0 to ${TABLE_LIMITS.sortMax}.`;
  if (Object.keys(errors).length > 0 || seats === null || sortOrder === null) return { body: null, errors };
  return { body: { name, area: area === '' ? null : area, seats, sort_order: sortOrder, is_active: draft.isActive }, errors };
}

/**
 * Admin → Tables (`settings.manage`; Dine-in Tables & Tabs §B): every table of
 * the branch (all pages), grouped by area, and the create / edit dialog with
 * delete. `409 "Table 5 has an open bill."` (delete or deactivate) shows in
 * the dialog's banner; `422`s show under their fields.
 */
export function useAdminTables() {
  const client = useQueryClient();
  const list = useCursorList<DiningTable>({
    queryKey: tableKeys.adminTables(),
    fetchPage: (cursor) => listAdminTables({ cursor, per_page: 100 }),
    fetchAll: true,
  });
  const groups = useMemo(() => groupByArea(list.items), [list.items]);

  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [errors, setErrors] = useState<TableDraftErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inFlight = useRef(false);

  function refresh() {
    void client.invalidateQueries({ queryKey: tableKeys.all });
  }

  function fail(error: unknown) {
    if (isApiValidationError(error)) {
      const mapped: TableDraftErrors = {};
      for (const [field, messages] of Object.entries(error.errors)) {
        const key = FIELD_OF[field];
        if (key && messages[0]) mapped[key] = messages[0];
      }
      if (Object.keys(mapped).length > 0) setErrors(mapped);
      else setBanner(error.message);
    } else {
      setBanner(getErrorMessage(error));
    }
  }

  async function save() {
    if (!draft || inFlight.current) return;
    setBanner(null);
    const checked = checkTableDraft(draft);
    setErrors(checked.errors);
    if (!checked.body) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const saved = draft.id === null ? await createTable(checked.body) : await updateTable(draft.id, checked.body);
      setDraft(null);
      // MASTER §6: save success is a toast.
      showToast(draft.id === null ? `Table ${saved.name} added.` : `Table ${saved.name} saved.`);
      refresh();
    } catch (error) {
      fail(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!draft || draft.id === null || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setBanner(null);
    try {
      await deleteTable(draft.id);
      setConfirmDelete(false);
      showToast(`Table ${draft.name.trim()} deleted.`);
      setDraft(null);
      refresh();
    } catch (error) {
      setConfirmDelete(false);
      fail(error);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function open(table: DiningTable | null) {
    setDraft(draftOf(table));
    setErrors({});
    setBanner(null);
    setConfirmDelete(false);
  }

  return {
    list,
    groups,
    draft,
    errors,
    banner,
    submitting,
    confirmDelete,
    openNew: () => open(null),
    openTable: (table: DiningTable) => open(table),
    change: (changes: Partial<Omit<TableDraft, 'id'>>) => {
      setDraft((current) => (current ? { ...current, ...changes } : current));
      setErrors({});
      setBanner(null);
    },
    close: () => {
      if (!inFlight.current) setDraft(null);
    },
    save: () => void save(),
    requestDelete: () => setConfirmDelete(true),
    cancelDelete: () => setConfirmDelete(false),
    confirmDeleteTable: () => void remove(),
  };
}

export type AdminTablesState = ReturnType<typeof useAdminTables>;
