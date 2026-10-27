/**
 * Floor plan grid (docs/api-contract.md → Table Management → §B).
 *
 * - Each area is one plan of 24 × 16 cells.
 * - A table is a rectangle or a circle, 1–6 cells wide and high (new: 2 × 2).
 *   A circle counts as its square for fit and overlap.
 * - `pos_x` / `pos_y` are both `null` (off the plan) or both integers ≥ 0.
 * - Fit: `pos_x + width ≤ 24` and `pos_y + height ≤ 16`.
 * - No two placed tables of the area overlap.
 *
 * The server runs the same checks on the area's final layout; the clients run
 * this before saving so the cashier sees the problem on the plan first.
 */

export const FLOOR_GRID_COLS = 24;
export const FLOOR_GRID_ROWS = 16;
export const TABLE_MIN_CELLS = 1;
export const TABLE_MAX_CELLS = 6;
export const TABLE_DEFAULT_CELLS = 2;

export type FloorRect = {
  id: number;
  pos_x: number | null;
  pos_y: number | null;
  width: number;
  height: number;
};

/**
 * One problem with a table on the plan:
 * - `partial`: only one of `pos_x` / `pos_y` is set, or a position isn't a whole number;
 * - `out_of_bounds`: the table doesn't fit inside the grid (or its size is outside 1–6);
 * - `overlap`: it overlaps `other_id` (an earlier table in the input).
 */
export type FloorLayoutIssue = {
  id: number;
  kind: 'partial' | 'out_of_bounds' | 'overlap';
  other_id: number | null;
};

/** Both coordinates set: the table is on the plan. */
export function isPlaced(t: Pick<FloorRect, 'pos_x' | 'pos_y'>): boolean {
  return t.pos_x !== null && t.pos_y !== null;
}

function validSize(n: number): boolean {
  return Number.isInteger(n) && n >= TABLE_MIN_CELLS && n <= TABLE_MAX_CELLS;
}

function fits(t: FloorRect): boolean {
  const x = t.pos_x as number;
  const y = t.pos_y as number;
  return (
    validSize(t.width) &&
    validSize(t.height) &&
    x >= 0 &&
    y >= 0 &&
    x + t.width <= FLOOR_GRID_COLS &&
    y + t.height <= FLOOR_GRID_ROWS
  );
}

function overlaps(a: FloorRect, b: FloorRect): boolean {
  const ax = a.pos_x as number;
  const ay = a.pos_y as number;
  const bx = b.pos_x as number;
  const by = b.pos_y as number;
  return ax < bx + b.width && bx < ax + a.width && ay < by + b.height && by < ay + a.height;
}

/**
 * The contract §B checks on one area's final layout (circles count as their square).
 *
 * Pass every table of the area (placed or not), in the area's order. Issues
 * come in input order. An overlapping pair is reported once, on the later
 * table, with `other_id` = the earlier one (highlight both).
 */
export function checkFloorLayout(tables: FloorRect[]): FloorLayoutIssue[] {
  const issues: FloorLayoutIssue[] = [];
  const placed: FloorRect[] = [];

  for (const t of tables) {
    const xNull = t.pos_x === null;
    const yNull = t.pos_y === null;
    if (xNull && yNull) continue;
    if (
      xNull !== yNull ||
      !Number.isInteger(t.pos_x) ||
      !Number.isInteger(t.pos_y)
    ) {
      issues.push({ id: t.id, kind: 'partial', other_id: null });
      continue;
    }
    if (!fits(t)) {
      issues.push({ id: t.id, kind: 'out_of_bounds', other_id: null });
    }
    for (const other of placed) {
      if (overlaps(other, t)) {
        issues.push({ id: t.id, kind: 'overlap', other_id: other.id });
      }
    }
    placed.push(t);
  }

  return issues;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

/**
 * Snap a fractional grid position into the grid for a table of this size.
 * Rounds to the nearest cell, then keeps the whole table inside the grid.
 */
export function snapToGrid(
  x: number,
  y: number,
  width: number,
  height: number,
): { pos_x: number; pos_y: number } {
  const maxX = Math.max(0, FLOOR_GRID_COLS - width);
  const maxY = Math.max(0, FLOOR_GRID_ROWS - height);
  const sx = Number.isFinite(x) ? Math.round(x) : 0;
  const sy = Number.isFinite(y) ? Math.round(y) : 0;
  // `+ 0` turns a rounded -0 into 0.
  return { pos_x: clamp(sx, 0, maxX) + 0, pos_y: clamp(sy, 0, maxY) + 0 };
}
