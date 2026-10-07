/**
 * Pure geometry for the SVG charts. No React, no colours: every function is
 * unit-tested on its own (`__tests__/chartMath.test.ts`).
 */

export type Ticks = {
  /** Top of the axis (≥ the data max, a multiple of `step`). */
  max: number;
  step: number;
  /** 0, step, 2·step … max. */
  values: number[];
};

const STEP_FACTORS = [1, 2, 2.5, 5] as const;

/**
 * "Nice" integer ticks for a count axis starting at 0: at most `maxTicks`
 * intervals, steps of 1, 2, 5, 10, 20, 25, 50 … An all-zero (or empty) series
 * gets a 0–1 axis so it still draws a baseline.
 */
export function niceTicks(dataMax: number, maxTicks = 4): Ticks {
  const top = Math.max(0, Math.ceil(dataMax));
  if (top === 0) return { max: 1, step: 1, values: [0, 1] };

  let step = 1;
  for (let magnitude = 1; ; magnitude *= 10) {
    const found = STEP_FACTORS.map((factor) => factor * magnitude).find(
      (candidate) => Number.isInteger(candidate) && Math.ceil(top / candidate) <= maxTicks,
    );
    if (found !== undefined) {
      step = found;
      break;
    }
  }
  const max = Math.ceil(top / step) * step;
  const values: number[] = [];
  for (let value = 0; value <= max; value += step) values.push(value);
  return { max, step, values };
}

export type Segment = {
  /** Index into the input values. */
  index: number;
  value: number;
  x: number;
  width: number;
  /** The last drawn segment carries the bar's rounded data-end. */
  isEnd: boolean;
};

/**
 * Horizontal stacked-bar segments from the baseline (x = 0). Zero values draw
 * nothing. A `gap` of surface separates touching segments: it is taken from
 * the end of every drawn segment except the last, so the bar's total length
 * stays `sum × scale`.
 */
export function stackedSegments(values: readonly number[], scale: number, gap: number): Segment[] {
  const drawn = values.map((value, index) => ({ value, index })).filter((entry) => entry.value > 0);
  let cursor = 0;
  return drawn.map((entry, position) => {
    const start = cursor;
    const end = start + entry.value * scale;
    cursor = end;
    const isEnd = position === drawn.length - 1;
    const width = Math.max(0, (isEnd ? end : end - gap) - start);
    return { index: entry.index, value: entry.value, x: start, width, isEnd };
  });
}

/**
 * A horizontal bar from `x0` (the baseline end: square) to `x1` (the data end:
 * rounded by `radius`), `height` tall at `y`. Works in both directions (a
 * negative value has `x1 < x0`). A bar shorter than its radius shrinks it.
 */
export function barPath(x0: number, x1: number, y: number, height: number, radius: number, roundEnd = true): string {
  const length = Math.abs(x1 - x0);
  if (length === 0) return '';
  const r = roundEnd ? Math.min(radius, length, height / 2) : 0;
  const bottom = y + height;
  if (x1 >= x0) {
    return (
      `M ${x0} ${y} H ${x1 - r}` +
      (r > 0 ? ` A ${r} ${r} 0 0 1 ${x1} ${y + r}` : '') +
      ` V ${bottom - r}` +
      (r > 0 ? ` A ${r} ${r} 0 0 1 ${x1 - r} ${bottom}` : '') +
      ` H ${x0} Z`
    );
  }
  return (
    `M ${x0} ${y} H ${x1 + r}` +
    (r > 0 ? ` A ${r} ${r} 0 0 0 ${x1} ${y + r}` : '') +
    ` V ${bottom - r}` +
    (r > 0 ? ` A ${r} ${r} 0 0 0 ${x1 + r} ${bottom}` : '') +
    ` H ${x0} Z`
  );
}

/** A linear scale from `[domainMin, domainMax]` to `[0, range]`. */
export function linearScale(domainMin: number, domainMax: number, range: number): (value: number) => number {
  const span = domainMax - domainMin;
  if (span <= 0) return () => 0;
  return (value) => ((value - domainMin) / span) * range;
}

/**
 * Domain of the margin chart, in basis points, rounded out to whole 10%
 * steps: always includes 0 and the reference threshold, and reaches below 0
 * only for negative margins (cost above price).
 */
export function marginDomain(values: readonly (number | null)[], thresholdBps: number): { min: number; max: number } {
  const known = values.filter((value): value is number => value !== null);
  const step = 1000;
  const high = Math.max(thresholdBps, ...known, step);
  const low = Math.min(0, ...known);
  return { min: Math.floor(low / step) * step, max: Math.ceil(high / step) * step };
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export type DonutSlice = {
  /** Index into the input values. */
  index: number;
  value: number;
  /** Radians, clockwise from 12 o'clock. */
  startAngle: number;
  endAngle: number;
  path: string;
};

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
}

function ringSegmentPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [ox0, oy0] = polar(cx, cy, outer, start);
  const [ox1, oy1] = polar(cx, cy, outer, end);
  const [ix1, iy1] = polar(cx, cy, inner, end);
  const [ix0, iy0] = polar(cx, cy, inner, start);
  return (
    `M ${ox0} ${oy0} A ${outer} ${outer} 0 ${large} 1 ${ox1} ${oy1}` +
    ` L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
  );
}

/** A full ring (one non-zero slice): two half arcs per edge, since one SVG arc can't close a circle. */
function fullRingPath(cx: number, cy: number, outer: number, inner: number): string {
  return (
    `M ${cx} ${cy - outer} A ${outer} ${outer} 0 1 1 ${cx} ${cy + outer} A ${outer} ${outer} 0 1 1 ${cx} ${cy - outer} Z` +
    ` M ${cx} ${cy - inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner} Z`
  );
}

/**
 * Donut slices, clockwise from 12 o'clock. Zero values draw no slice (they
 * still belong in the legend). Adjacent slices are separated by a `gapPx`
 * surface gap measured along the ring's middle; a single slice is a full ring.
 */
export function donutSlices(
  values: readonly number[],
  geometry: { cx: number; cy: number; outer: number; inner: number; gapPx: number },
): DonutSlice[] {
  const { cx, cy, outer, inner, gapPx } = geometry;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return [];
  const drawn = values.map((value, index) => ({ value, index })).filter((entry) => entry.value > 0);

  if (drawn.length === 1) {
    const only = drawn[0];
    return [{ index: only.index, value: only.value, startAngle: 0, endAngle: TAU, path: fullRingPath(cx, cy, outer, inner) }];
  }

  const gapAngle = gapPx / ((outer + inner) / 2);
  let cursor = 0;
  return drawn.map((entry) => {
    const start = cursor;
    const end = start + (entry.value / total) * TAU;
    cursor = end;
    const half = Math.min(gapAngle / 2, (end - start) / 4);
    return {
      index: entry.index,
      value: entry.value,
      startAngle: start,
      endAngle: end,
      path: ringSegmentPath(cx, cy, outer, inner, start + half, end - half),
    };
  });
}

/** Angle of a point around (cx, cy), clockwise from 12 o'clock, in [0, 2π). */
export function angleOf(x: number, y: number, cx: number, cy: number): number {
  const angle = Math.atan2(x - cx, cy - y);
  return angle < 0 ? angle + TAU : angle;
}

/** The slice under a tap at (x, y), or `null` outside the ring (with a little tolerance). */
export function sliceAt(
  slices: readonly DonutSlice[],
  x: number,
  y: number,
  geometry: { cx: number; cy: number; outer: number; inner: number },
  tolerance = 12,
): DonutSlice | null {
  const distance = Math.hypot(x - geometry.cx, y - geometry.cy);
  if (distance < geometry.inner - tolerance || distance > geometry.outer + tolerance) return null;
  const angle = angleOf(x, y, geometry.cx, geometry.cy);
  return slices.find((slice) => angle >= slice.startAngle && angle < slice.endAngle) ?? null;
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

export type Point = { x: number; y: number };

/**
 * Points of one series on a shared y-scale (`domainMax`), each centred in its
 * column: x = (i + 0.5) × plotWidth / n, y = plotHeight at 0 and 0 at `domainMax`.
 */
export function linePoints(values: readonly number[], plotWidth: number, plotHeight: number, domainMax: number): Point[] {
  const count = values.length;
  if (count === 0) return [];
  const column = plotWidth / count;
  const y = linearScale(0, domainMax, plotHeight);
  return values.map((value, index) => ({ x: (index + 0.5) * column, y: plotHeight - y(value) }));
}

/** SVG path through the points (straight segments). */
export function linePath(points: readonly Point[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

