/**
 * A chart in a white card (MASTER §3 "Charts"): the title and description, a
 * **View as table** toggle (`aria-pressed`), and either the chart (a labelled
 * figure) or its data as a table.
 */
import { ChartColumnIcon, TableIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { ChartTable, type TableData } from '@/components/charts/chartParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ChartCardProps = {
  title: string;
  description?: string;
  /** A one-sentence summary of the data for screen readers. */
  summary: string;
  table: TableData;
  children: ReactNode;
  /** Extra content under the chart (a legend, a link). */
  footer?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function ChartCard({ title, description, summary, table, children, footer, actions, className }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <Card className={cn('flex min-w-0 flex-col gap-3 p-5', className)} aria-labelledby={titleId} role="region">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button variant="outline" size="sm" aria-pressed={asTable} onClick={() => setAsTable((value) => !value)}>
            {asTable ? <ChartColumnIcon aria-hidden="true" /> : <TableIcon aria-hidden="true" />}
            {asTable ? 'View as chart' : 'View as table'}
          </Button>
        </div>
      </div>
      {asTable ? (
        <ChartTable table={table} label={title} />
      ) : (
        <div role="figure" aria-label={summary} className="min-w-0">
          {children}
        </div>
      )}
      {footer}
    </Card>
  );
}
