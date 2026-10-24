/**
 * **Bill items** on a tab (Dine-in Tables & Tabs §I): what was sent to the
 * kitchen, by round, each line with its paid and cancelled quantities and a
 * **Cancel** for what remains (reason + manager PIN). Below: what is left to
 * pay (before discounts and service charge) and the orders already settled.
 */
import { BanIcon } from 'lucide-react';

import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Tab, TabItem } from '@/services/types';
import { formatPeso } from '@pos/core/money';

type BillItemsCardProps = {
  tab: Tab;
  /** `null`: cancelling is unavailable (offline, a request running). */
  onCancel: ((item: TabItem) => void) | null;
};

function rounds(items: readonly TabItem[]): { roundNo: number; items: TabItem[] }[] {
  const byRound = new Map<number, TabItem[]>();
  for (const item of items) byRound.set(item.round_no, [...(byRound.get(item.round_no) ?? []), item]);
  return [...byRound.entries()].map(([roundNo, list]) => ({ roundNo, items: list }));
}

export function BillItemsCard({ tab, onCancel }: BillItemsCardProps) {
  const groups = rounds(tab.items);

  return (
    <Card className="flex flex-col gap-4 p-4" aria-label="Bill items">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="text-xl font-bold">Bill items</h2>
        <Badge tone="neutral" className="px-3">
          {tab.rounds_count} {tab.rounds_count === 1 ? 'round' : 'rounds'}
        </Badge>
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Nothing sent to the kitchen yet.</p>
      ) : (
        <div className="flex max-h-[min(480px,50dvh)] flex-col gap-4 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group.roundNo} aria-labelledby={`round-${group.roundNo}`} className="flex flex-col gap-2">
              <h3 id={`round-${group.roundNo}`} className="text-sm font-semibold text-muted-foreground">
                Round {group.roundNo}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <BillItemRow key={item.id} item={item} onCancel={onCancel} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-subtle p-4">
        <span className="font-semibold">Left to pay</span>
        <span className="text-2xl font-bold text-green tabular">{formatPeso(tab.remaining_cents)}</span>
      </div>
      <p className="-mt-2 text-[13px] text-muted-foreground">Before discounts and the service charge.</p>

      {tab.orders.length > 0 ? (
        <section aria-label="Paid so far" className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">Paid so far</h3>
          {tab.orders.map((order) => (
            <div key={order.ulid} className="flex justify-between text-muted-foreground">
              <span>{order.invoice_no}</span>
              <span className="tabular">{formatPeso(order.total_cents)}</span>
            </div>
          ))}
        </section>
      ) : null}
    </Card>
  );
}

function BillItemRow({ item, onCancel }: { item: TabItem; onCancel: BillItemsCardProps['onCancel'] }) {
  const done = item.remaining_qty === 0;
  return (
    <li className={cn('flex items-start gap-3 rounded-lg border border-border p-3', done && 'bg-subtle')}>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', done && 'text-muted-foreground')}>
          {item.qty} x {item.product_name}
        </p>
        {item.notes ? <p className="text-[13px] text-muted-foreground">&gt; {item.notes}</p> : null}
        <div className="mt-1 flex flex-wrap gap-1">
          {item.settled_qty > 0 ? (
            <StatusBadge tone="success" label={`${item.settled_qty} paid`} />
          ) : null}
          {item.cancelled_qty > 0 ? (
            <StatusBadge tone="danger" label={`${item.cancelled_qty} cancelled`} />
          ) : null}
          {item.remaining_qty > 0 && item.remaining_qty !== item.qty ? (
            <Badge tone="neutral">
              {item.remaining_qty} left
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-sm font-bold text-green tabular">{formatPeso(item.unit_price_cents * item.remaining_qty)}</span>
        {item.remaining_qty > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-danger-bg"
            onClick={() => onCancel?.(item)}
            disabled={onCancel === null}
          >
            <BanIcon aria-hidden="true" />
            Cancel
            <span className="sr-only"> {item.product_name}</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
