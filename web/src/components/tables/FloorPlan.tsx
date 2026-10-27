/**
 * The floor plan grid (Table Management §B/§C): one area drawn as a
 * 24 × 16 grid that scales to the width of its card. Tables sit at their
 * cell position and size (a `round` table is drawn as a circle in its square).
 * Used by the Sell → Tables floor view (read-only, tap to act) and the
 * floor plan editor (drag with pointer events).
 */
import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/utils';

import { floorSlotStyle, GRID_LINES, type FloorCellRect } from './floorPlanStyles';

type FloorGridProps = {
  /** Accessible name of the plan ("Floor plan, Patio"). */
  label: string;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
};

export function FloorGrid({ label, children, className, ref }: FloorGridProps) {
  return (
    <div ref={ref} role="group" aria-label={label} className={cn('relative w-full rounded-lg border border-border bg-subtle', className)} style={GRID_LINES}>
      {children}
    </div>
  );
}

/** A cell rectangle on the grid; its child fills it, inset a little so neighbours stay apart. */
export function FloorSlot({ rect, children, className }: { rect: FloorCellRect; children: ReactNode; className?: string }) {
  return (
    <div className={cn('absolute p-0.5', className)} style={floorSlotStyle(rect)}>
      {children}
    </div>
  );
}
