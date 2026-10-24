/**
 * The Tables view (Dine-in Tables & Tabs §C/§I): the branch's active tables
 * as cards grouped by area. A card shows the name, Free or Occupied, the
 * guests, the remaining amount and the time since the bill opened (amber
 * after 90 minutes). A free table opens a bill (asking for guests); an
 * occupied one opens its bill. Polled every 15 s while shown, and after every
 * tab action. Offline: "Tables need a connection." and no actions.
 */
import { ClockIcon, UsersIcon, WifiOffIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useTablesView } from '@/hooks/useDiningTables';
import { useOnline } from '@/hooks/useOnline';
import { cn } from '@/lib/utils';
import type { Tab, TableView } from '@/services/types';
import { formatElapsed, groupByArea, LONG_TABLE_MINUTES, minutesSince, NO_AREA_LABEL, TABLES_OFFLINE_MESSAGE } from '@/utils/tables';
import { formatPeso } from '@pos/core/money';

import { OpenTabDialog } from './OpenTabDialog';

/** The wall clock, refreshed every `everyMs` (the elapsed times on the cards). */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function TablesView({ onOpenTab }: { onOpenTab: (ulid: string) => void }) {
  const online = useOnline();
  const list = useTablesView(online);
  const now = useNow(30_000);
  const [opening, setOpening] = useState<TableView | null>(null);
  const groups = useMemo(() => groupByArea(list.items), [list.items]);

  if (!online) {
    return (
      <Card className="p-6">
        <p className="flex items-center gap-2 font-semibold" role="status">
          <WifiOffIcon className="size-5 text-warning" aria-hidden="true" />
          {TABLES_OFFLINE_MESSAGE}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Pay now still works. The tables come back when this computer is online.</p>
      </Card>
    );
  }
  if (list.loading) {
    return (
      <Card>
        <LoadingRows rows={4} label="Loading tables…" />
      </Card>
    );
  }
  if (list.error) {
    return (
      <Card>
        <ErrorState title="Couldn't load the tables" message={list.error} onRetry={list.retry} />
      </Card>
    );
  }
  if (list.items.length === 0) {
    return (
      <Card>
        <EmptyState title="No tables yet" message="A manager adds the dining tables under Tables in the menu (or from Receipt settings → Dine-in)." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`area-${group.key}`} className="flex flex-col gap-3">
          <h2 id={`area-${group.key}`} className="text-base font-semibold">
            {group.area ?? NO_AREA_LABEL}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
            {group.tables.map((table) => (
              <li key={table.id}>
                <TableCard
                  table={table}
                  now={now}
                  onSelect={() => (table.tab ? onOpenTab(table.tab.ulid) : setOpening(table))}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <LoadMoreFooter
        shown={list.items.length}
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onLoadMore={list.loadMore}
        error={list.loadMoreError}
        noun="tables"
      />
      <OpenTabDialog
        table={opening}
        onClose={() => setOpening(null)}
        onOpened={(tab: Tab) => {
          setOpening(null);
          onOpenTab(tab.ulid);
        }}
      />
    </div>
  );
}

function TableCard({ table, now, onSelect }: { table: TableView; now: number; onSelect: () => void }) {
  const tab = table.tab;
  const minutes = tab ? minutesSince(tab.opened_at, now) : 0;
  const long = tab !== null && minutes >= LONG_TABLE_MINUTES;
  const label = tab
    ? `Table ${table.name}, occupied, ${tab.guests} guests, ${formatPeso(tab.remaining_cents)}, open ${formatElapsed(minutes)}`
    : `Table ${table.name}, free, ${table.seats} seats. Open a bill`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className={cn(
        'flex h-full min-h-32 w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-card transition-colors hover:border-green-line',
        tab ? 'border-green-line bg-green-soft' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl font-bold">{table.name}</span>
        {tab ? <StatusBadge tone="success" label="Occupied" /> : <StatusBadge tone="info" label="Free" />}
      </div>
      {tab ? (
        <>
          <span className="flex items-center gap-1.5 text-sm">
            <UsersIcon className="size-4" aria-hidden="true" />
            {tab.guests} {tab.guests === 1 ? 'guest' : 'guests'} · {tab.item_count} {tab.item_count === 1 ? 'item' : 'items'}
          </span>
          <span className="text-lg font-bold text-green tabular">{formatPeso(tab.remaining_cents)}</span>
          <span className={cn('flex items-center gap-1.5 text-sm', long ? 'font-semibold text-warning' : 'text-muted-foreground')}>
            <ClockIcon className="size-4" aria-hidden="true" />
            {formatElapsed(minutes)}
          </span>
        </>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <UsersIcon className="size-4" aria-hidden="true" />
          {table.seats} {table.seats === 1 ? 'seat' : 'seats'}
        </span>
      )}
    </button>
  );
}
