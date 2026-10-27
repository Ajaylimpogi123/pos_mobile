/**
 * The floor plan editor's state (Table Management §B/§F; `settings.manage`).
 *
 * - Reads every admin table (`useAllAdminTables`), one **area** at a time
 *   (`null` = the tables with no area).
 * - Changes are drafts per table (position, size, shape) until **Save**,
 *   which sends only the changed tables to `PUT /admin/tables/layout` (the
 *   server checks them against the area's other tables where they are).
 * - Before saving, the shared `checkFloorLayout` (`@pos/core`) runs the same
 *   fit and overlap check on the area's final layout; a problem blocks Save
 *   and highlights the table. The server's `422`s (`tables.{i}.pos_x` …) are
 *   mapped back to their tables and highlighted the same way.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { tableKeys, useAllAdminTables, useSaveTableLayout } from '@/hooks/useDiningTables';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { DiningTable, TableLayoutEntry, TableShape } from '@/services/types';
import { groupByArea } from '@/utils/tables';
import {
  checkFloorLayout,
  FLOOR_GRID_COLS,
  FLOOR_GRID_ROWS,
  isPlaced,
  snapToGrid,
  TABLE_MAX_CELLS,
  TABLE_MIN_CELLS,
  type FloorLayoutIssue,
} from '@pos/core/tables/floorPlan';

/** The plan fields of one table. */
type Layout = Omit<TableLayoutEntry, 'id'>;

/** A table as the editor shows it: the server's row with the draft applied. */
export type EditorTable = DiningTable & { changed: boolean };

/** The server's limit on `tables` in one layout save. */
const MAX_TABLES_PER_SAVE = 100;

function layoutOf(table: DiningTable): Layout {
  return { pos_x: table.pos_x, pos_y: table.pos_y, width: table.width, height: table.height, shape: table.shape };
}

function sameLayout(a: Layout, b: Layout): boolean {
  return a.pos_x === b.pos_x && a.pos_y === b.pos_y && a.width === b.width && a.height === b.height && a.shape === b.shape;
}

function clampCells(value: number): number {
  return Math.min(TABLE_MAX_CELLS, Math.max(TABLE_MIN_CELLS, Math.round(value)));
}

/** The table's name in a message ("Table 5"). */
function tableLabel(tables: readonly DiningTable[], id: number | null): string {
  const found = id === null ? undefined : tables.find((table) => table.id === id);
  return `Table ${found?.name ?? id ?? '?'}`;
}

/** The same wording as the server's `422`s (§B). */
function issueMessage(issue: FloorLayoutIssue, tables: readonly DiningTable[]): string {
  if (issue.kind === 'partial') return 'Place the table or leave it off the plan.';
  if (issue.kind === 'out_of_bounds') return `${tableLabel(tables, issue.id)} doesn't fit on the plan.`;
  return `${tableLabel(tables, issue.id)} overlaps ${tableLabel(tables, issue.other_id)}.`;
}

export function useFloorPlanEditor() {
  const queryClient = useQueryClient();
  const source = useAllAdminTables();
  const save = useSaveTableLayout();
  const [chosenArea, setChosenArea] = useState<string | null | undefined>(undefined);
  const [drafts, setDrafts] = useState<ReadonlyMap<number, Layout>>(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** The server's `422`s, by table id, from the last save. */
  const [serverIssues, setServerIssues] = useState<ReadonlyMap<number, string>>(new Map());
  const [banner, setBanner] = useState<string | null>(null);

  const areas = useMemo(() => groupByArea(source.tables ?? []), [source.tables]);
  // The first area until one is chosen (and when the chosen one no longer exists).
  const area = chosenArea !== undefined && areas.some((group) => group.area === chosenArea) ? chosenArea : (areas[0]?.area ?? null);
  const group = areas.find((candidate) => candidate.area === area) ?? null;

  const tables = useMemo<EditorTable[]>(
    () =>
      (group?.tables ?? []).map((table) => {
        const draft = drafts.get(table.id);
        return draft ? { ...table, ...draft, changed: !sameLayout(draft, layoutOf(table)) } : { ...table, changed: false };
      }),
    [group, drafts],
  );

  const issues = useMemo(() => {
    const byTable = new Map<number, string>();
    for (const issue of checkFloorLayout(tables)) {
      if (!byTable.has(issue.id)) byTable.set(issue.id, issueMessage(issue, tables));
    }
    for (const [id, message] of serverIssues) if (!byTable.has(id)) byTable.set(id, message);
    return byTable;
  }, [tables, serverIssues]);

  const changed = tables.filter((table) => table.changed);
  const dirty = changed.length > 0;
  const selected = tables.find((table) => table.id === selectedId) ?? null;

  function update(id: number, next: Partial<Layout>) {
    const base = tables.find((table) => table.id === id);
    if (!base) return;
    setDrafts((current) => {
      const copy = new Map(current);
      copy.set(id, { ...layoutOf(base), ...next });
      return copy;
    });
    setServerIssues((current) => {
      if (!current.has(id)) return current;
      const copy = new Map(current);
      copy.delete(id);
      return copy;
    });
    setBanner(null);
  }

  /** Puts a table's top-left corner at fractional cell `(x, y)`, snapped and kept on the grid. */
  function moveTo(id: number, x: number, y: number) {
    const table = tables.find((candidate) => candidate.id === id);
    if (!table) return;
    update(id, snapToGrid(x, y, table.width, table.height));
  }

  /** The first free spot (left to right, top to bottom) for a table of this size, or `null`. */
  function firstFreeSpot(id: number): { pos_x: number; pos_y: number } | null {
    const table = tables.find((candidate) => candidate.id === id);
    if (!table) return null;
    const others = tables.filter((candidate) => candidate.id !== id && isPlaced(candidate));
    for (let y = 0; y + table.height <= FLOOR_GRID_ROWS; y += 1) {
      for (let x = 0; x + table.width <= FLOOR_GRID_COLS; x += 1) {
        const trial = [...others, { ...table, pos_x: x, pos_y: y }];
        if (!checkFloorLayout(trial).some((issue) => issue.id === id || issue.other_id === id)) return { pos_x: x, pos_y: y };
      }
    }
    return null;
  }

  function reset() {
    setDrafts(new Map());
    setServerIssues(new Map());
    setBanner(null);
    save.reset();
  }

  async function submit(): Promise<boolean> {
    if (!dirty || save.isPending) return false;
    if (issues.size > 0) {
      setBanner('Fix the highlighted tables first: each table must fit on the plan without overlapping another.');
      return false;
    }
    if (changed.length > MAX_TABLES_PER_SAVE) {
      setBanner(`Save at most ${MAX_TABLES_PER_SAVE} tables at a time.`);
      return false;
    }
    const entries: TableLayoutEntry[] = changed.map((table) => ({ id: table.id, ...layoutOf(table) }));
    setBanner(null);
    setServerIssues(new Map());
    try {
      const saved = await save.mutateAsync({ area, tables: entries });
      // Show the saved plan at once (the lists also reload).
      queryClient.setQueryData<DiningTable[]>(tableKeys.adminAll, (current) =>
        current ? current.map((table) => saved.find((row) => row.id === table.id) ?? table) : current,
      );
      setDrafts(new Map());
      return true;
    } catch (error) {
      if (isApiValidationError(error)) {
        const byTable = new Map<number, string>();
        let unmatched: string | null = null;
        for (const [field, messages] of Object.entries(error.errors)) {
          const match = /^tables\.(\d+)\./.exec(field);
          const entry = match ? entries[Number(match[1])] : undefined;
          if (entry && messages[0]) {
            if (!byTable.has(entry.id)) byTable.set(entry.id, messages[0]);
          } else unmatched ??= messages[0] ?? null;
        }
        setServerIssues(byTable);
        setBanner(unmatched ?? (byTable.size > 0 ? "The plan wasn't saved. Fix the highlighted tables." : error.message));
      } else {
        setBanner(getErrorMessage(error));
      }
      return false;
    }
  }

  return {
    loading: source.loading,
    error: source.error,
    reload: source.reload,
    areas,
    area,
    /** Switch area (the caller asks first when there are unsaved changes; they are dropped). */
    chooseArea: (next: string | null) => {
      reset();
      setSelectedId(null);
      setChosenArea(next);
    },
    tables,
    issues,
    dirty,
    changedCount: changed.length,
    selected,
    select: setSelectedId,
    moveTo,
    nudge: (id: number, dx: number, dy: number) => {
      const table = tables.find((candidate) => candidate.id === id);
      if (!table || table.pos_x === null || table.pos_y === null) return;
      moveTo(id, table.pos_x + dx, table.pos_y + dy);
    },
    place: (id: number) => {
      const spot = firstFreeSpot(id);
      if (spot) update(id, spot);
      else setBanner('There is no free space for this table. Move or shrink another table first.');
    },
    unplace: (id: number) => update(id, { pos_x: null, pos_y: null }),
    resize: (id: number, width: number, height: number) => update(id, { width: clampCells(width), height: clampCells(height) }),
    setShape: (id: number, shape: TableShape) => update(id, { shape }),
    discard: () => {
      reset();
      setSelectedId(null);
    },
    submit,
    saving: save.isPending,
    banner,
  };
}

export type FloorPlanEditorState = ReturnType<typeof useFloorPlanEditor>;
