/**
 * The MASTER §3 stat card: a 36 px icon square in the accent tint, an
 * optional trend badge, the label, the value (24–26/700 in the accent colour)
 * and a one-line footnote. The value is always a figure the server returned
 * (back-office.md: never money computed on the client), and the trend shows
 * only when the API gives the comparison.
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** §1.4 accents by meaning; `neutral` for any other figure (staff, customers, changes…). */
export type StatAccent = 'sales' | 'orders' | 'average' | 'stock' | 'neutral';

const ACCENTS: Record<StatAccent, { square: string; value: string }> = {
  sales: { square: 'bg-stat-sales-tint text-stat-sales', value: 'text-stat-sales' },
  orders: { square: 'bg-stat-orders-tint text-stat-orders', value: 'text-stat-orders' },
  average: { square: 'bg-stat-average-tint text-stat-average', value: 'text-stat-average' },
  stock: { square: 'bg-stat-stock-tint text-stat-stock', value: 'text-stat-stock' },
  neutral: { square: 'bg-accent text-foreground', value: 'text-foreground' },
};

/** A comparison the API returned: ▲/▼ plus its text ("12% vs last week"), green when up, red when down. */
export type StatTrend = { direction: 'up' | 'down'; text: string };

type StatCardProps = {
  label: string;
  /** A short caption after the label, e.g. the period the figure covers ("Today", "October 2026"). */
  caption?: string | null;
  value: string;
  icon: LucideIcon;
  accent: StatAccent;
  footnote?: ReactNode;
  trend?: StatTrend | null;
};

function TrendBadge({ trend }: { trend: StatTrend }) {
  const up = trend.direction === 'up';
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-semibold tabular',
        up ? 'text-success' : 'text-danger',
      )}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {trend.text}
    </span>
  );
}

export function StatCard({ label, caption, value, icon: Icon, accent, footnote, trend }: StatCardProps) {
  const tone = ACCENTS[accent];
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex size-9 items-center justify-center rounded-lg', tone.square)}>
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {trend ? <TrendBadge trend={trend} /> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {label}
        {caption ? <span className="font-medium text-foreground"> · {caption}</span> : null}
      </p>
      <p className={cn('text-[26px] leading-tight font-bold tabular', tone.value)}>{value}</p>
      {footnote ? <p className="text-[13px] text-muted-foreground">{footnote}</p> : null}
    </Card>
  );
}
