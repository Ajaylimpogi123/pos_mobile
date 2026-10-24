/**
 * DataTable: the legacy `Components/data-table.jsx` look (shadcn Table inside
 * a white card, MASTER §3 "Data table") on TanStack Table v9. Server-driven
 * only: filtering and paging go through the contract's query parameters, so
 * the table never sorts or filters on the client (back-office.md).
 *
 * - A row click, or Enter on a focused row, calls `onRowClick` (opens the
 *   detail sheet). Numbers are right-aligned and tabular (`meta.align: 'right'`).
 * - The caller renders the loading / empty / error states and the cursor
 *   "Load more" footer around it (`@/components/common/ListStates`).
 */
import { createColumnHelper, tableFeatures, useTable, type ColumnDef, type RowData } from '@tanstack/react-table';
import type { KeyboardEvent, ReactNode } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DataTableColumnMeta = {
  align?: 'left' | 'right';
  /** Extra classes for the column's cells. */
  className?: string;
  /** Header text for screen readers when the visible header is empty (e.g. the row actions). */
  srLabel?: string;
};

// eslint-disable-next-line react-refresh/only-export-components
export const dataTableFeatures = tableFeatures({ columnMeta: {} as DataTableColumnMeta });

export type DataTableFeatures = typeof dataTableFeatures;

export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData>;

// eslint-disable-next-line react-refresh/only-export-components
export function dataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  /** Accessible name of the table. */
  label: string;
  rowLabel?: (row: TData) => string;
  /** A totals row under the body: one cell per column id (missing ids stay empty). */
  footer?: Readonly<Record<string, ReactNode>>;
};

export function DataTable<TData extends RowData>({ columns, data, getRowId, onRowClick, label, rowLabel, footer }: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId: (row) => getRowId(row),
  });

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: TData) {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  }

  return (
    <Table aria-label={label}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              return (
                <TableHead key={header.id} className={cn(meta?.align === 'right' && 'text-right')}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  {meta?.srLabel ? <span className="sr-only">{meta.srLabel}</span> : null}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            tabIndex={onRowClick ? 0 : undefined}
            aria-label={rowLabel ? rowLabel(row.original) : undefined}
            className={cn(onRowClick && 'cursor-pointer')}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            onKeyDown={(event) => onRowKeyDown(event, row.original)}
          >
            {row.getAllCells().map((cell) => {
              const meta = cell.column.columnDef.meta;
              return (
                <TableCell key={cell.id} className={cn(meta?.align === 'right' && 'text-right tabular', meta?.className)}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
      {footer ? (
        <tfoot className="border-t-2 border-border bg-subtle font-semibold">
          <TableRow className="hover:bg-transparent">
            {table.getAllLeafColumns().map((column) => {
              const meta = column.columnDef.meta;
              return (
                <TableCell key={column.id} className={cn(meta?.align === 'right' && 'text-right tabular')}>
                  {footer[column.id] ?? null}
                </TableCell>
              );
            })}
          </TableRow>
        </tfoot>
      ) : null}
    </Table>
  );
}
