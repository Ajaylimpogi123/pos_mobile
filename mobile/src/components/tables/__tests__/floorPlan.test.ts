/**
 * Table Management §B (docs/api-contract.md v1.29): the shared floor plan
 * grid and the fit and overlap check the server runs on an area's layout.
 */
import {
  checkFloorLayout,
  FLOOR_GRID_COLS,
  FLOOR_GRID_ROWS,
  isPlaced,
  snapToGrid,
  TABLE_DEFAULT_CELLS,
  TABLE_MAX_CELLS,
  TABLE_MIN_CELLS,
  type FloorRect,
} from '@pos/core/tables/floorPlan';

function rect(id: number, pos_x: number | null, pos_y: number | null, width = 2, height = 2): FloorRect {
  return { id, pos_x, pos_y, width, height };
}

describe('grid constants', () => {
  it('matches the contract', () => {
    expect([FLOOR_GRID_COLS, FLOOR_GRID_ROWS]).toEqual([24, 16]);
    expect([TABLE_MIN_CELLS, TABLE_MAX_CELLS, TABLE_DEFAULT_CELLS]).toEqual([1, 6, 2]);
  });
});

describe('isPlaced', () => {
  it('needs both coordinates', () => {
    expect(isPlaced({ pos_x: 0, pos_y: 0 })).toBe(true);
    expect(isPlaced({ pos_x: null, pos_y: null })).toBe(false);
    expect(isPlaced({ pos_x: 3, pos_y: null })).toBe(false);
  });
});

describe('checkFloorLayout', () => {
  it('accepts a clean layout and ignores unplaced tables', () => {
    expect(checkFloorLayout([rect(1, 0, 0), rect(2, 2, 0), rect(3, null, null), rect(4, 22, 14)])).toEqual([]);
  });

  it('flags one coordinate without the other, and fractions', () => {
    expect(checkFloorLayout([rect(1, 3, null), rect(2, null, 4), rect(3, 1.5, 0)])).toEqual([
      { id: 1, kind: 'partial', other_id: null },
      { id: 2, kind: 'partial', other_id: null },
      { id: 3, kind: 'partial', other_id: null },
    ]);
  });

  it('checks pos + size against 24 × 16', () => {
    expect(checkFloorLayout([rect(1, 22, 0)])).toEqual([]);
    expect(checkFloorLayout([rect(1, 23, 0)])).toEqual([{ id: 1, kind: 'out_of_bounds', other_id: null }]);
    expect(checkFloorLayout([rect(1, 0, 15)])).toEqual([{ id: 1, kind: 'out_of_bounds', other_id: null }]);
    expect(checkFloorLayout([rect(1, -1, 0)])).toEqual([{ id: 1, kind: 'out_of_bounds', other_id: null }]);
    expect(checkFloorLayout([rect(1, 0, 0, 7, 2)])).toEqual([{ id: 1, kind: 'out_of_bounds', other_id: null }]);
  });

  it('reports each overlapping pair once, on the later table', () => {
    expect(checkFloorLayout([rect(5, 0, 0), rect(6, 1, 1), rect(7, 4, 4)])).toEqual([{ id: 6, kind: 'overlap', other_id: 5 }]);
    // Touching edges don't overlap.
    expect(checkFloorLayout([rect(5, 0, 0), rect(6, 2, 0), rect(7, 0, 2)])).toEqual([]);
    // A big table overlapping two.
    expect(checkFloorLayout([rect(1, 0, 0), rect(2, 3, 0), rect(3, 1, 0, 3, 1)])).toEqual([
      { id: 3, kind: 'overlap', other_id: 1 },
      { id: 3, kind: 'overlap', other_id: 2 },
    ]);
  });
});

describe('snapToGrid', () => {
  it('rounds to the nearest cell', () => {
    expect(snapToGrid(3.4, 2.6, 2, 2)).toEqual({ pos_x: 3, pos_y: 3 });
  });

  it('keeps the whole table inside the grid', () => {
    expect(snapToGrid(-0.4, -3, 2, 2)).toEqual({ pos_x: 0, pos_y: 0 });
    expect(snapToGrid(30, 30, 3, 4)).toEqual({ pos_x: 21, pos_y: 12 });
    expect(snapToGrid(Number.NaN, 5, 2, 2)).toEqual({ pos_x: 0, pos_y: 5 });
  });

  it('never returns -0', () => {
    expect(Object.is(snapToGrid(-0.2, -0.2, 1, 1).pos_x, 0)).toBe(true);
  });
});
