import {
  angleOf,
  barPath,
  donutSlices,
  linePoints,
  marginDomain,
  niceTicks,
  sliceAt,
  stackedSegments,
} from '@/components/charts/chartMath';

describe('niceTicks', () => {
  it.each([
    [0, 1, [0, 1]],
    [3, 3, [0, 1, 2, 3]],
    [4, 4, [0, 1, 2, 3, 4]],
    [6, 6, [0, 2, 4, 6]],
    [14, 15, [0, 5, 10, 15]],
    [37, 40, [0, 10, 20, 30, 40]],
    [90, 100, [0, 25, 50, 75, 100]],
  ])('max %i → axis top %i', (dataMax, top, values) => {
    const ticks = niceTicks(dataMax);
    expect(ticks.max).toBe(top);
    expect(ticks.values).toEqual(values);
  });
});

describe('stackedSegments', () => {
  it('stacks from the baseline with a 2px gap between touching segments', () => {
    // Available 2, Unavailable 1 at 10 px per product.
    expect(stackedSegments([2, 1], 10, 2)).toEqual([
      { index: 0, value: 2, x: 0, width: 18, isEnd: false },
      { index: 1, value: 1, x: 20, width: 10, isEnd: true },
    ]);
  });

  it('keeps the total length = sum × scale (the gap comes out of the inner segment)', () => {
    const segments = stackedSegments([3, 2], 8, 2);
    const last = segments[segments.length - 1];
    expect(last.x + last.width).toBe(40);
  });

  it('draws nothing for zero values and never leaves a gap at the end', () => {
    expect(stackedSegments([2, 0], 10, 2)).toEqual([{ index: 0, value: 2, x: 0, width: 20, isEnd: true }]);
    expect(stackedSegments([0, 3], 10, 2)).toEqual([{ index: 1, value: 3, x: 0, width: 30, isEnd: true }]);
    expect(stackedSegments([0, 0], 10, 2)).toEqual([]);
  });
});

describe('barPath', () => {
  it('rounds only the data end (square at the baseline)', () => {
    const path = barPath(0, 50, 0, 16, 4);
    expect(path.startsWith('M 0 0 H 46')).toBe(true);
    expect(path).toContain('A 4 4 0 0 1 50 4');
    expect(path.endsWith('H 0 Z')).toBe(true);
  });

  it('shrinks the radius on tiny bars and returns nothing for zero length', () => {
    expect(barPath(0, 2, 0, 16, 4)).toContain('A 2 2');
    expect(barPath(10, 10, 0, 16, 4)).toBe('');
  });

  it('draws negative bars leftwards, rounded at their data end', () => {
    expect(barPath(40, 10, 0, 16, 4)).toContain('A 4 4 0 0 0 10 4');
  });
});

describe('marginDomain', () => {
  it('rounds out to 10% steps and always includes 0 and the threshold', () => {
    expect(marginDomain([5500, 2000, null], 3000)).toEqual({ min: 0, max: 6000 });
    expect(marginDomain([null, null], 3000)).toEqual({ min: 0, max: 3000 });
    expect(marginDomain([-1250, 800], 3000)).toEqual({ min: -2000, max: 3000 });
  });
});

describe('donutSlices', () => {
  const geometry = { cx: 50, cy: 50, outer: 50, inner: 24, gapPx: 2 };

  it('skips zero values (they draw no slice)', () => {
    const slices = donutSlices([1, 4, 0], geometry);
    expect(slices.map((slice) => slice.index)).toEqual([0, 1]);
    expect(slices[0].endAngle).toBeCloseTo((Math.PI * 2) / 5);
    expect(slices[1].endAngle).toBeCloseTo(Math.PI * 2);
  });

  it('draws a single non-zero value as a full ring, and nothing for all zeros', () => {
    const [only] = donutSlices([0, 3, 0], geometry);
    expect(only.index).toBe(1);
    expect(only.endAngle - only.startAngle).toBeCloseTo(Math.PI * 2);
    expect(donutSlices([0, 0], geometry)).toEqual([]);
  });

  it('finds the slice under a tap, clockwise from 12 o’clock', () => {
    const slices = donutSlices([1, 1], geometry);
    expect(angleOf(90, 50, 50, 50)).toBeCloseTo(Math.PI / 2);
    // Right side (3 o'clock) is in the first half; left side (9 o'clock) in the second.
    expect(sliceAt(slices, 88, 50, geometry)?.index).toBe(0);
    expect(sliceAt(slices, 12, 50, geometry)?.index).toBe(1);
    // The hole in the middle is not a slice.
    expect(sliceAt(slices, 50, 50, geometry)).toBeNull();
  });
});

describe('linePoints', () => {
  it('places every series on the same y-scale, each point centred in its column', () => {
    const logins = linePoints([0, 6], 200, 160, 15);
    const changes = linePoints([0, 14], 200, 160, 15);
    expect(logins[0]).toEqual({ x: 50, y: 160 });
    expect(changes[0]).toEqual({ x: 50, y: 160 });
    expect(logins[1].x).toBe(150);
    expect(logins[1].y).toBeCloseTo(160 - (6 / 15) * 160);
    expect(changes[1].y).toBeCloseTo(160 - (14 / 15) * 160);
  });
});
