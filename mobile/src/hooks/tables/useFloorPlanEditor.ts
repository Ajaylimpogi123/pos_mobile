import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';

import { groupByArea, tableLabel, type AreaGroup } from '@/components/tables/tableLabels';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { listAdminTables, saveTableLayout } from '@/services/tables';
import type { DiningTable, TableLayoutEntry, TableShape } from '@/services/types';
import { showToast } from '@/stores/toast';
import {
  checkFloorLayout,
  FLOOR_GRID_COLS,
  FLOOR_GRID_ROWS,
  isPlaced,
  snapToGrid,
  TABLE_MAX_CELLS,
  TABLE_MIN_CELLS,
  type FloorRect,
} from '@pos/core/tables/floorPlan';

/** Safety cap on pages read at once (100 tables a page). */
const MAX_PAGES = 10;

export const FLOOR_PLAN_SAVED_MESSAGE = 'Floor plan saved.';
export const FIX_LAYOUT_MESSAGE = 'Fix the highlighted tables, then save again.';

/** GET /api/v1/admin/tables, every page (inactive tables included). */
export async function fetchAllAdminTables(): Promise<DiningTable[]> {
  const rows: DiningTable[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await listAdminTables({ cursor, per_page: 100 });
    rows.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return rows;
}

/** The plan fields of one table (what `PUT /admin/tables/layout` takes). */
export type PlanFields = Pick<DiningTable, 'pos_x' | 'pos_y' | 'width' | 'height' | 'shape'>;

/** A table as drawn in the editor: the saved table with the unsaved edits applied. */
export type EditorTable = DiningTable & { dirty: boolean };

function samePlan(a: PlanFields, b: PlanFields): boolean {
  return a.pos_x === b.pos_x && a.pos_y === b.pos_y && a.width === b.width && a.height === b.height && a.shape === b.shape;
}

function clampCells(n: number): number {
  return Math.min(TABLE_MAX_CELLS, Math.max(TABLE_MIN_CELLS, Math.round(n)));
}

/** The first top-left cell (row by row) where a `width × height` table fits without overlapping. */
export function firstFreeCell(others: readonly FloorRect[], width: number, height: number): { pos_x: number; pos_y: number } | null {
  for (let y = 0; y + height <= FLOOR_GRID_ROWS; y += 1) {
    for (let x = 0; x + width <= FLOOR_GRID_COLS; x += 1) {
      const candidate: FloorRect = { id: -1, pos_x: x, pos_y: y, width, height };
      if (checkFloorLayout([...others, candidate]).every((issue) => issue.id !== -1)) return { pos_x: x, pos_y: y };
    }
  }
  return null;
}

/** The §B messages for the client-side check, by table id (both tables of an overlap are marked). */
export function layoutIssueMessages(tables: readonly EditorTable[]): Record<number, string> {
  const names = new Map(tables.map((table) => [table.id, table.name]));
  const messages: Record<number, string> = {};
  for (const issue of checkFloorLayout(tables.map((table) => ({ id: table.id, pos_x: table.pos_x, pos_y: table.pos_y, width: table.width, height: table.height })))) {
    const name = tableLabel(names.get(issue.id) ?? String(issue.id));
    if (issue.kind === 'partial') messages[issue.id] = 'Place the table or leave it off the plan.';
    else if (issue.kind === 'out_of_bounds') messages[issue.id] = `${name} doesn't fit on the plan.`;
    else if (issue.other_id !== null) {
      const other = tableLabel(names.get(issue.other_id) ?? String(issue.other_id));
      messages[issue.id] = `${name} overlaps ${other}.`;
      messages[issue.other_id] ??= `${other} overlaps ${name}.`;
    }
  }
  return messages;
}

/**
 * Tables → **Floor plan** (Table Management §B and §F; `settings.manage`):
 * the area picker, the plan, the Unplaced tray and the selected table's
 * size, shape and **Remove from plan**. Edits stay on the device until
 * **Save** (one `PUT /admin/tables/layout` for the area, atomic) or
 * **Discard**; the shared fit and overlap check runs before saving, and a
 * `422` highlights the table it names. The edits live here, above any layout
 * switch, so rotation keeps them.
 */
export function useFloorPlanEditor(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: tableKeys.floorPlan(), queryFn: fetchAllAdminTables, enabled });
  const tables = useMemo(() => query.data ?? [], [query.data]);
  const areas: AreaGroup<DiningTable>[] = useMemo(() => groupByArea(tables), [tables]);

  const [chosenArea, setChosenArea] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, PlanFields>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [serverIssues, setServerIssues] = useState<Record<number, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const area = areas.find((group) => group.key === chosenArea) ?? areas[0] ?? null;

  const areaTables: EditorTable[] = useMemo(
    () =>
      (area?.items ?? []).map((table) => {
        const edit = edits[table.id];
        return edit ? { ...table, ...edit, dirty: !samePlan(edit, table) } : { ...table, dirty: false };
      }),
    [area, edits],
  );
  const dirty = areaTables.some((table) => table.dirty);
  const placed = areaTables.filter((table) => isPlaced(table));
  const unplaced = areaTables.filter((table) => !isPlaced(table));
  const clientIssues = useMemo(() => layoutIssueMessages(areaTables), [areaTables]);
  const issues = useMemo(() => ({ ...clientIssues, ...serverIssues }), [clientIssues, serverIssues]);
  const selected = areaTables.find((table) => table.id === selectedId) ?? null;

  function edit(id: number, change: (current: EditorTable) => PlanFields) {
    const current = areaTables.find((table) => table.id === id);
    if (!current) return;
    const next = change(current);
    setEdits((all) => ({ ...all, [id]: next }));
    setServerIssues((all) => {
      if (!(id in all)) return all;
      const rest = { ...all };
      delete rest[id];
      return rest;
    });
    setBanner(null);
  }

  function plan(table: EditorTable): PlanFields {
    return { pos_x: table.pos_x, pos_y: table.pos_y, width: table.width, height: table.height, shape: table.shape };
  }

  /** Drops a table at a fractional grid position (snapped into the grid). Returns whether it moved. */
  function moveTo(id: number, x: number, y: number): boolean {
    const current = areaTables.find((table) => table.id === id);
    if (!current) return false;
    const cell = snapToGrid(x, y, current.width, current.height);
    if (cell.pos_x === current.pos_x && cell.pos_y === current.pos_y) return false;
    edit(id, (table) => ({ ...plan(table), ...cell }));
    setSelectedId(id);
    return true;
  }

  async function save() {
    if (!area || inFlight.current) return;
    if (Object.keys(clientIssues).length > 0) {
      setBanner(FIX_LAYOUT_MESSAGE);
      return;
    }
    const changed = areaTables.filter((table) => table.dirty);
    if (changed.length === 0) return;
    const entries: TableLayoutEntry[] = changed.map((table) => ({ id: table.id, ...plan(table) }));
    inFlight.current = true;
    setSaving(true);
    setBanner(null);
    try {
      const saved = await saveTableLayout({ area: area.items[0]?.area ?? null, tables: entries });
      const byId = new Map(saved.map((table) => [table.id, table]));
      client.setQueryData<DiningTable[]>(tableKeys.floorPlan(), (old) => old?.map((table) => byId.get(table.id) ?? table));
      setEdits({});
      setServerIssues({});
      void client.invalidateQueries({ queryKey: tableKeys.adminTables(), exact: true });
      void client.invalidateQueries({ queryKey: tableKeys.tablesView() });
      showToast(FLOOR_PLAN_SAVED_MESSAGE);
    } catch (error) {
      if (isApiValidationError(error)) {
        const found: Record<number, string> = {};
        for (const [field, messages] of Object.entries(error.errors)) {
          const match = /^tables\.(\d+)\./.exec(field);
          const entry = match ? entries[Number(match[1])] : undefined;
          if (entry && messages[0]) found[entry.id] = messages[0];
        }
        setServerIssues(found);
        setBanner(Object.keys(found).length > 0 ? FIX_LAYOUT_MESSAGE : error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    query,
    areas,
    area,
    areaTables,
    placed,
    unplaced,
    issues,
    selected,
    dirty,
    saving,
    banner,
    chooseArea: (key: string) => {
      setChosenArea(key);
      setEdits({});
      setSelectedId(null);
      setServerIssues({});
      setBanner(null);
    },
    select: (id: number | null) => setSelectedId(id),
    moveTo,
    /** A tap on a cell: the selected table goes there (its top-left corner). */
    placeAtCell: (x: number, y: number) => {
      if (selectedId === null) return;
      moveTo(selectedId, x, y);
    },
    /** Puts an unplaced table at the first free spot (the accessible alternative to dragging). */
    placeFirstFree: (id: number) => {
      const current = areaTables.find((table) => table.id === id);
      if (!current) return;
      const spot = firstFreeCell(
        placed.filter((table) => table.id !== id),
        current.width,
        current.height,
      );
      if (!spot) {
        setBanner('There is no free space for this table. Move or remove another table first.');
        return;
      }
      edit(id, (table) => ({ ...plan(table), ...spot }));
      setSelectedId(id);
    },
    nudge: (id: number, dx: number, dy: number) => {
      const current = areaTables.find((table) => table.id === id);
      if (!current || !isPlaced(current)) return;
      moveTo(id, (current.pos_x ?? 0) + dx, (current.pos_y ?? 0) + dy);
    },
    resize: (id: number, size: { width?: number; height?: number }) =>
      edit(id, (table) => {
        const width = clampCells(size.width ?? table.width);
        const height = clampCells(size.height ?? table.height);
        const position = isPlaced(table) ? snapToGrid(table.pos_x ?? 0, table.pos_y ?? 0, width, height) : { pos_x: null, pos_y: null };
        return { ...plan(table), ...position, width, height };
      }),
    setShape: (id: number, shape: TableShape) => edit(id, (table) => ({ ...plan(table), shape })),
    unplace: (id: number) => edit(id, (table) => ({ ...plan(table), pos_x: null, pos_y: null })),
    discard: () => {
      setEdits({});
      setServerIssues({});
      setBanner(null);
    },
    save: () => void save(),
  };
}

export type FloorPlanEditorState = ReturnType<typeof useFloorPlanEditor>;
