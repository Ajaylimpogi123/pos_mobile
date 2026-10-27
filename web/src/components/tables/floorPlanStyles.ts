/** Layout helpers of the floor plan grid (`FloorPlan.tsx`): cell rectangles as % of the grid. */
import type { CSSProperties } from 'react';

import type { TableShape } from '@/services/types';
import { FLOOR_GRID_COLS, FLOOR_GRID_ROWS } from '@pos/core/tables/floorPlan';

export type FloorCellRect = { pos_x: number; pos_y: number; width: number; height: number };

/** The absolute position of a rectangle of cells, in % of the grid (scales with the card). */
export function floorSlotStyle(rect: FloorCellRect): CSSProperties {
  return {
    left: `${(rect.pos_x / FLOOR_GRID_COLS) * 100}%`,
    top: `${(rect.pos_y / FLOOR_GRID_ROWS) * 100}%`,
    width: `${(rect.width / FLOOR_GRID_COLS) * 100}%`,
    height: `${(rect.height / FLOOR_GRID_ROWS) * 100}%`,
  };
}

/** The cell lines, drawn from the theme's `border` token. */
export const GRID_LINES: CSSProperties = {
  aspectRatio: `${FLOOR_GRID_COLS} / ${FLOOR_GRID_ROWS}`,
  backgroundImage: 'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
  backgroundSize: `calc(100% / ${FLOOR_GRID_COLS}) calc(100% / ${FLOOR_GRID_ROWS})`,
};

/** The table's outline: a rounded rectangle, or a circle for `round`. */
export function shapeClass(shape: TableShape): string {
  return shape === 'round' ? 'rounded-full' : 'rounded-lg';
}
