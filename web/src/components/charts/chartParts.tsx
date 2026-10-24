/**
 * Shared chart pieces (MASTER §3 "Charts"): the tooltip, the legend, and the
 * "View as table" fallback. Only the dashboard and report pages import
 * charts, so Recharts loads in their lazy chunks and never in the cashier's
 * Sell bundle.
 */
import { SERIES_COLORS, type SeriesSlot } from '@/components/charts/chartTheme';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** The data of a chart as a plain table (the "View as table" fallback). */
export type TableData = {
  columns: readonly { label: string; numeric?: boolean }[];
  rows: readonly (readonly string[])[];
  footer?: readonly string[];
};

export function ChartTable({ table, label }: { table: TableData; label: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-border">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {table.columns.map((column) => (
              <TableHead key={column.label} className={cn(column.numeric && 'text-right')}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className={cn(table.columns[cellIndex]?.numeric && 'text-right tabular')}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {table.footer ? (
            <TableRow className="font-semibold hover:bg-transparent">
              {table.footer.map((cell, cellIndex) => (
                <TableCell key={cellIndex} className={cn(table.columns[cellIndex]?.numeric && 'text-right tabular')}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}

/** A legend: a colour swatch plus the series label (and an optional figure), never colour alone. */
export function ChartLegend({ items }: { items: readonly { label: string; slot: SeriesSlot; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: SERIES_COLORS[item.slot] }} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value ? <span className="font-semibold tabular">{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export type TooltipRow = { label: string; value: string; slot?: SeriesSlot };

/** The tooltip box: a title and one row per series (white card, hairline border). */
export function TooltipBox({ title, rows }: { title: string; rows: readonly TooltipRow[] }) {
  return (
    <div className="min-w-40 rounded-lg border border-border bg-card px-3 py-2 text-[13px] shadow-card">
      <p className="mb-1 font-semibold">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {row.slot !== undefined ? (
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: SERIES_COLORS[row.slot] }} />
            ) : null}
            {row.label}
          </span>
          <span className="font-semibold tabular">{row.value}</span>
        </p>
      ))}
    </div>
  );
}
