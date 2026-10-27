/**
 * The floor plan editor (Table Management §B/§F; `settings.manage`): an area
 * picker, the 24 × 16 grid and an **Unplaced** tray.
 *
 * - **Drag** a table (mouse, pen or touch: pointer events, no library) onto
 *   the grid or across it; it snaps to cells. Dropping it on the tray takes
 *   it off the plan. A click selects it.
 * - **Keyboard:** a placed table moves one cell with the arrow keys; a
 *   selected unplaced table has **Place on plan** (first free spot).
 * - The selected table shows width, height and shape, plus **Remove from plan**.
 * - **Save** and **Discard**; a table that doesn't fit or overlaps another
 *   (shared check, or the server's `422`) is outlined in red with its message.
 * - On a phone the plan is view-only.
 */
import { LoaderCircleIcon, MapPinIcon, MapPinOffIcon, SaveIcon, Undo2Icon } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { toast } from 'sonner';

import { Banner } from '@/components/common/Banner';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { QtyStepper, Segmented } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import type { EditorTable, FloorPlanEditorState } from '@/hooks/useFloorPlanEditor';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/utils';
import type { TableShape } from '@/services/types';
import { FLOOR_PLAN_PHONE_NOTE, NO_AREA_LABEL } from '@/utils/tables';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS, isPlaced, snapToGrid, TABLE_MAX_CELLS, TABLE_MIN_CELLS } from '@pos/core/tables/floorPlan';

import { FloorGrid, FloorSlot } from './FloorPlan';
import { shapeClass } from './floorPlanStyles';

/** A drag in progress (kept in a ref: pointer moves don't re-render until the snapped cell changes). */
type Drag = {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  /** The grab point inside the table, in cells. */
  offsetX: number;
  offsetY: number;
  moved: boolean;
};

/** Where a dragged table would land. */
type Drop = { id: number; target: 'grid'; pos_x: number; pos_y: number } | { id: number; target: 'tray' } | { id: number; target: 'none' };

/** Pixels a pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

const AREA_NONE_VALUE = '__none__';

const SHAPE_OPTIONS: readonly { value: TableShape; label: string }[] = [
  { value: 'rect', label: 'Square' },
  { value: 'round', label: 'Round' },
];

type FloorPlanEditorProps = {
  editor: FloorPlanEditorState;
  /** Runs `run` now, or after the user agrees to drop the unsaved changes (`useLeaveGuard`). */
  confirmLeave: (run: () => void) => void;
};

export function FloorPlanEditor({ editor, confirmLeave }: FloorPlanEditorProps) {
  const online = useOnline();
  const phone = useMediaQuery('(max-width: 639px)');
  const gridRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const readOnly = phone;

  if (editor.loading) {
    return (
      <Card>
        <LoadingRows rows={6} label="Loading the floor plan…" />
      </Card>
    );
  }
  if (editor.error) {
    return (
      <Card>
        <ErrorState title="Couldn't load the tables" message={editor.error} onRetry={editor.reload} />
      </Card>
    );
  }
  if (editor.areas.length === 0) {
    return (
      <Card>
        <EmptyState title="No tables yet" message="Add the dining tables in the List tab first, then place them on the plan here." />
      </Card>
    );
  }

  const placed = editor.tables.filter((table) => isPlaced(table));
  const unplaced = editor.tables.filter((table) => !isPlaced(table));
  const selected = editor.selected;
  const dragging = drop?.id ?? null;

  function landing(event: PointerEvent<HTMLElement>, current: Drag, table: EditorTable): Drop {
    const grid = gridRef.current?.getBoundingClientRect();
    const tray = trayRef.current?.getBoundingClientRect();
    const inside = (rect: DOMRect | undefined) =>
      rect !== undefined && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (grid && inside(grid)) {
      const x = ((event.clientX - grid.left) / grid.width) * FLOOR_GRID_COLS - current.offsetX;
      const y = ((event.clientY - grid.top) / grid.height) * FLOOR_GRID_ROWS - current.offsetY;
      return { id: current.id, target: 'grid', ...snapToGrid(x, y, table.width, table.height) };
    }
    if (inside(tray)) return { id: current.id, target: 'tray' };
    return { id: current.id, target: 'none' };
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, table: EditorTable) {
    if (readOnly || event.button !== 0) return;
    const grid = gridRef.current?.getBoundingClientRect();
    let offsetX = table.width / 2;
    let offsetY = table.height / 2;
    if (grid && table.pos_x !== null && table.pos_y !== null) {
      offsetX = ((event.clientX - grid.left) / grid.width) * FLOOR_GRID_COLS - table.pos_x;
      offsetY = ((event.clientY - grid.top) / grid.height) * FLOOR_GRID_ROWS - table.pos_y;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: table.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX, offsetY, moved: false };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>, table: EditorTable) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
    current.moved = true;
    const next = landing(event, current, table);
    setDrop((previous) =>
      previous &&
      previous.target === next.target &&
      (next.target !== 'grid' || (previous.target === 'grid' && previous.pos_x === next.pos_x && previous.pos_y === next.pos_y))
        ? previous
        : next,
    );
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>, table: EditorTable) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDrop(null);
    if (!current.moved) {
      editor.select(table.id);
      return;
    }
    const target = landing(event, current, table);
    if (target.target === 'grid') editor.moveTo(table.id, target.pos_x, target.pos_y);
    else if (target.target === 'tray' && isPlaced(table)) editor.unplace(table.id);
    editor.select(table.id);
  }

  function onPointerCancel() {
    drag.current = null;
    setDrop(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, table: EditorTable) {
    if (readOnly) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (move && isPlaced(table)) {
      event.preventDefault();
      editor.select(table.id);
      editor.nudge(table.id, move[0], move[1]);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && isPlaced(table)) {
      event.preventDefault();
      editor.unplace(table.id);
    }
  }

  function tableProps(table: EditorTable) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => onPointerDown(event, table),
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => onPointerMove(event, table),
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => onPointerUp(event, table),
      onPointerCancel,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, table),
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        // Pointer presses select on pointer-up; this is the keyboard's Enter / Space.
        if (event.detail === 0) editor.select(table.id);
      },
    };
  }

  async function onSave() {
    if (await editor.submit()) toast.success(`Floor plan of ${editor.area ?? NO_AREA_LABEL} saved.`);
  }

  const ghost = drop && drop.target === 'grid' ? editor.tables.find((table) => table.id === drop.id) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="floor-area">Area</Label>
          <NativeSelect
            id="floor-area"
            className="w-56"
            value={editor.area ?? AREA_NONE_VALUE}
            onChange={(event) => {
              const next = event.target.value === AREA_NONE_VALUE ? null : event.target.value;
              confirmLeave(() => editor.chooseArea(next));
            }}
          >
            {editor.areas.map((group) => (
              <option key={group.key} value={group.area ?? AREA_NONE_VALUE}>
                {group.area ?? NO_AREA_LABEL} ({group.tables.length})
              </option>
            ))}
          </NativeSelect>
        </div>
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {editor.dirty ? (
              <span className="text-sm text-muted-foreground" role="status">
                {editor.changedCount} unsaved {editor.changedCount === 1 ? 'change' : 'changes'}
              </span>
            ) : null}
            <Button variant="outline" size="lg" onClick={editor.discard} disabled={!editor.dirty || editor.saving}>
              <Undo2Icon aria-hidden="true" />
              Discard
            </Button>
            <Button variant="green" size="lg" onClick={() => void onSave()} disabled={!editor.dirty || editor.saving || !online}>
              {editor.saving ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <SaveIcon aria-hidden="true" />}
              {editor.saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </Card>

      {readOnly ? <Banner variant="info">{FLOOR_PLAN_PHONE_NOTE}</Banner> : null}
      {!online ? <Banner variant="warning">This computer is offline. The floor plan saves once it is back online.</Banner> : null}
      {editor.banner ? <Banner>{editor.banner}</Banner> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="flex flex-col gap-3 p-3">
          <FloorGrid ref={gridRef} label={`Floor plan, ${editor.area ?? NO_AREA_LABEL}`} className="touch-none select-none">
            {placed.map((table) => (
              <FloorSlot
                key={table.id}
                rect={{ pos_x: table.pos_x ?? 0, pos_y: table.pos_y ?? 0, width: table.width, height: table.height }}
                className={cn(dragging === table.id && 'opacity-40')}
              >
                <EditorTile table={table} selected={selected?.id === table.id} issue={editor.issues.get(table.id) ?? null} readOnly={readOnly} {...tableProps(table)} />
              </FloorSlot>
            ))}
            {ghost && drop && drop.target === 'grid' ? (
              <FloorSlot rect={{ pos_x: drop.pos_x, pos_y: drop.pos_y, width: ghost.width, height: ghost.height }} className="pointer-events-none">
                <div aria-hidden="true" className={cn('size-full border-2 border-dashed border-green-line bg-green-soft/60', shapeClass(ghost.shape))} />
              </FloorSlot>
            ) : null}
          </FloorGrid>
          {readOnly ? null : (
            <p className="text-[13px] text-muted-foreground">
              Drag a table to place or move it; it snaps to the grid. Arrow keys move the focused table one cell. Drop it on Unplaced to take it off
              the plan.
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card
            ref={trayRef}
            role="region"
            className={cn('flex flex-col gap-3 p-4', drop?.target === 'tray' && 'border-green-line bg-green-soft')}
            aria-labelledby="floor-tray-title"
          >
            <h3 id="floor-tray-title" className="text-sm font-semibold">
              Unplaced <span className="font-normal text-muted-foreground">· {unplaced.length}</span>
            </h3>
            {unplaced.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Every table of this area is on the plan.</p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
                {unplaced.map((table) => (
                  <li key={table.id} className={cn('h-16 touch-none select-none', dragging === table.id && 'opacity-40')}>
                    <EditorTile table={table} selected={selected?.id === table.id} issue={editor.issues.get(table.id) ?? null} readOnly={readOnly} {...tableProps(table)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {selected && !readOnly ? <SelectedPanel table={selected} editor={editor} issue={editor.issues.get(selected.id) ?? null} /> : null}
        </div>
      </div>
    </div>
  );
}

type EditorTileProps = {
  table: EditorTable;
  selected: boolean;
  issue: string | null;
  readOnly: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

function EditorTile({ table, selected, issue, readOnly, ...handlers }: EditorTileProps) {
  const where = isPlaced(table) ? `at column ${(table.pos_x ?? 0) + 1}, row ${(table.pos_y ?? 0) + 1}` : 'not on the plan';
  const label = `Table ${table.name}, ${table.width} by ${table.height} ${table.shape === 'round' ? 'round' : 'square'}, ${where}${
    table.is_active ? '' : ', inactive'
  }${issue ? `. ${issue}` : ''}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      title={issue ?? undefined}
      className={cn(
        '@container flex size-full flex-col items-center justify-center overflow-hidden border-2 bg-card p-0.5 text-center shadow-card',
        shapeClass(table.shape),
        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        issue ? 'border-destructive bg-danger-bg' : selected ? 'border-green bg-green-soft' : 'border-border',
        !table.is_active && 'border-dashed opacity-70',
      )}
      {...handlers}
    >
      <span className="text-sm leading-tight font-bold @min-[80px]:text-base">{table.name}</span>
      <span className="hidden text-xs leading-tight text-muted-foreground @min-[64px]:block">
        {table.is_active ? `${table.seats} seats` : 'Inactive'}
      </span>
      {table.changed ? <span className="sr-only">, not saved</span> : null}
    </button>
  );
}

function SelectedPanel({ table, editor, issue }: { table: EditorTable; editor: FloorPlanEditorState; issue: string | null }) {
  const placed = isPlaced(table);
  return (
    <Card role="region" className="flex flex-col gap-4 p-4" aria-labelledby="floor-selected-title">
      <div>
        <h3 id="floor-selected-title" className="text-base font-semibold">
          Table {table.name}
        </h3>
        <p className="text-[13px] text-muted-foreground">
          {table.seats} {table.seats === 1 ? 'seat' : 'seats'}
          {table.is_active ? '' : ' · Inactive'}
          {placed ? ` · column ${(table.pos_x ?? 0) + 1}, row ${(table.pos_y ?? 0) + 1}` : ' · not on the plan'}
        </p>
      </div>
      {issue ? (
        <p className="text-[13px] font-medium text-danger" role="alert">
          {issue}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Width (cells)</span>
        <QtyStepper
          value={table.width}
          onChange={(width) => editor.resize(table.id, width, table.height)}
          min={TABLE_MIN_CELLS}
          max={TABLE_MAX_CELLS}
          label={`width of table ${table.name}`}
          disabled={editor.saving}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Height (cells)</span>
        <QtyStepper
          value={table.height}
          onChange={(height) => editor.resize(table.id, table.width, height)}
          min={TABLE_MIN_CELLS}
          max={TABLE_MAX_CELLS}
          label={`height of table ${table.name}`}
          disabled={editor.saving}
        />
      </div>
      <Segmented label="Shape" value={table.shape} options={SHAPE_OPTIONS} onChange={(shape) => editor.setShape(table.id, shape)} disabled={editor.saving} />
      {placed ? (
        <Button variant="destructive" onClick={() => editor.unplace(table.id)} disabled={editor.saving}>
          <MapPinOffIcon aria-hidden="true" />
          Remove from plan
        </Button>
      ) : (
        <Button variant="outline" onClick={() => editor.place(table.id)} disabled={editor.saving}>
          <MapPinIcon aria-hidden="true" />
          Place on plan
        </Button>
      )}
    </Card>
  );
}
