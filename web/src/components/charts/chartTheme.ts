/**
 * Chart styling (MASTER §1.4): the series colours in their fixed order, as
 * theme variables (never a hex), plus the axis, grid and reference styling.
 */

/** The series colours, in this order and never cycled (MASTER §1.4). */
export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'] as const;
export type SeriesSlot = 0 | 1 | 2;

/** Area fills use the series colour at 18 % opacity. */
export const AREA_FILL_OPACITY = 0.18;

export const AXIS_TICK = { fill: 'var(--muted-text)', fontSize: 12 } as const;
export const GRID_STROKE = 'var(--border)';
export const REFERENCE_STROKE = 'var(--muted-text)';

export type ChartSeries = { key: string; label: string; slot: SeriesSlot };
