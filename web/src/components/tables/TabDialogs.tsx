/**
 * The tab screen's dialogs (Dine-in Tables & Tabs §D/§I):
 * - **Pay**: the whole bill, **By item** (quantities up to what remains) or
 *   **Equally** (2–10 shares, T2), then the checkout.
 * - **Guests**: `PATCH /tabs/{ulid}` (guests and note).
 * - **Transfer** (T2): to a free table. **Merge** (T2): into another open bill.
 * - **Close**: only with nothing left to pay (cancelled, or opened by mistake).
 * - The `409` dialog: the message, then the tab reloads.
 */
import { ArrowRightLeftIcon, LoaderCircleIcon, MergeIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { QtyStepper, Segmented } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useTablesView } from '@/hooks/useDiningTables';
import { useTabAction, useTabCache } from '@/hooks/useTab';
import { cn } from '@/lib/utils';
import { mergeTab, transferTab, updateTab } from '@/services/tabs';
import type { Tab, TabItem, TableView } from '@/services/types';
import { TAB_LIMITS } from '@/utils/tables';
import { formatPeso } from '@pos/core/money';
import { equalSplitShares, SPLIT_COUNT_MAX, SPLIT_COUNT_MIN } from '@pos/core/sale/serviceCharge';
import { tabRemainingLines } from '@pos/core/sale/tab';

// ---------------------------------------------------------------------------
// Pay: what to settle
// ---------------------------------------------------------------------------

export type PayChoice = { mode: 'whole' } | { mode: 'items'; qty: Record<number, number> } | { mode: 'equal'; count: number };

type PayMode = PayChoice['mode'];

export function PayDialog({
  tab,
  open,
  onClose,
  onContinue,
}: {
  tab: Tab;
  open: boolean;
  onClose: () => void;
  onContinue: (choice: PayChoice) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">{open ? <PayForm tab={tab} onClose={onClose} onContinue={onContinue} /> : null}</DialogContent>
    </Dialog>
  );
}

function PayForm({ tab, onClose, onContinue }: { tab: Tab; onClose: () => void; onContinue: (choice: PayChoice) => void }) {
  const remaining = useMemo(() => tabRemainingLines(tab), [tab]);
  const [mode, setMode] = useState<PayMode>('whole');
  const [qty, setQty] = useState<Record<number, number>>({});
  const [count, setCount] = useState(2);
  const picked = remaining.reduce((sum, item) => sum + (qty[item.id] ?? 0), 0);
  const pickedCents = remaining.reduce((sum, item) => sum + (qty[item.id] ?? 0) * item.unit_price_cents, 0);
  const canContinue = remaining.length > 0 && (mode !== 'items' || picked > 0);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canContinue) return;
    if (mode === 'whole') onContinue({ mode: 'whole' });
    else if (mode === 'items') onContinue({ mode: 'items', qty });
    else onContinue({ mode: 'equal', count });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>Pay table {tab.table.name}</DialogTitle>
        <DialogDescription>{formatPeso(tab.remaining_cents)} left to pay, before discounts and the service charge.</DialogDescription>
      </DialogHeader>
      <Segmented<PayMode>
        label="How is it paid?"
        value={mode}
        options={[
          { value: 'whole', label: 'Whole bill' },
          { value: 'items', label: 'By item' },
          { value: 'equal', label: 'Equally' },
        ]}
        onChange={setMode}
      />

      {mode === 'items' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Choose what this guest pays. Each payment gets its own receipt.</p>
          <ul className="flex max-h-[45dvh] flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {remaining.map((item: TabItem) => (
              <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.product_name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {formatPeso(item.unit_price_cents)} each · {item.remaining_qty} left · round {item.round_no}
                  </p>
                </div>
                <QtyStepper
                  value={qty[item.id] ?? 0}
                  min={0}
                  max={item.remaining_qty}
                  onChange={(value) => setQty((current) => ({ ...current, [item.id]: value }))}
                  label={`quantity of ${item.product_name} to pay`}
                  size="sm"
                />
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold">
            {picked} {picked === 1 ? 'item' : 'items'} · {formatPeso(pickedCents)}
          </p>
        </div>
      ) : null}

      {mode === 'equal' ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Number of shares</span>
          <QtyStepper value={count} min={SPLIT_COUNT_MIN} max={SPLIT_COUNT_MAX} onChange={setCount} label="shares" />
          <p className="text-[13px] text-muted-foreground">
            Before discounts and the service charge: about {formatPeso(equalSplitShares(tab.remaining_cents, count)[0] ?? 0)} each. Each
            share is paid and gets its own receipt.
          </p>
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="green" size="lg" disabled={!canContinue}>
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Guests and note (PATCH /tabs/{ulid})
// ---------------------------------------------------------------------------

export function GuestsDialog({ tab, open, onClose, onConflict }: { tab: Tab; open: boolean; onClose: () => void; onConflict: (message: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md">{open ? <GuestsForm tab={tab} onClose={onClose} onConflict={onConflict} /> : null}</DialogContent>
    </Dialog>
  );
}

function GuestsForm({ tab, onClose, onConflict }: { tab: Tab; onClose: () => void; onConflict: (message: string) => void }) {
  const saveTab = useTabCache();
  const [guests, setGuests] = useState(tab.guests);
  const [notes, setNotes] = useState(tab.notes ?? '');
  const action = useTabAction({
    run: (key, body: { guests: number; notes: string | null }) => updateTab(tab.ulid, body, key),
    onConflict: (message) => {
      onClose();
      onConflict(message);
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const updated = await action.send({ guests, notes: notes.trim() === '' ? null : notes.trim() });
    if (updated) {
      saveTab(updated);
      toast.success('Guests and note saved.');
      onClose();
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={action.busy}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>Table {tab.table.name}</DialogTitle>
        <DialogDescription>The guests and the note for this bill.</DialogDescription>
      </DialogHeader>
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Guests</span>
        <QtyStepper value={guests} onChange={setGuests} min={TAB_LIMITS.guestsMin} max={TAB_LIMITS.guestsMax} label="guests" disabled={action.busy} />
        {action.fieldErrors.guests ? <p className="text-[13px] font-medium text-danger">{action.fieldErrors.guests}</p> : null}
      </div>
      <FormField label="Note (optional)" error={action.fieldErrors.notes}>
        <Input value={notes} maxLength={TAB_LIMITS.notesMax} autoComplete="off" onChange={(event) => setNotes(event.target.value)} disabled={action.busy} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <Button type="submit" variant="green" disabled={action.busy}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {action.busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Transfer and merge (T2)
// ---------------------------------------------------------------------------

type MoveKind = 'transfer' | 'merge';

/**
 * Transfer: pick a free table. Merge: pick another occupied table; its bill
 * stays, this one's remaining items move into its next round (no kitchen
 * ticket), and this bill becomes `merged`.
 */
export function MoveTabDialog({
  tab,
  kind,
  onClose,
  onMoved,
  onConflict,
}: {
  tab: Tab;
  kind: MoveKind | null;
  onClose: () => void;
  /** The tab to show next: the same one (transfer) or the target (merge). */
  onMoved: (tab: Tab) => void;
  onConflict: (message: string) => void;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-xl">
        {kind ? <MoveForm key={kind} tab={tab} kind={kind} onClose={onClose} onMoved={onMoved} onConflict={onConflict} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  tab,
  kind,
  onClose,
  onMoved,
  onConflict,
}: {
  tab: Tab;
  kind: MoveKind;
  onClose: () => void;
  onMoved: (tab: Tab) => void;
  onConflict: (message: string) => void;
}) {
  const saveTab = useTabCache();
  const list = useTablesView(true);
  const [target, setTarget] = useState<TableView | null>(null);
  const action = useTabAction({
    run: (key, chosen: TableView) =>
      kind === 'transfer'
        ? transferTab(tab.ulid, { table_id: chosen.id }, key)
        : mergeTab(tab.ulid, { into_ulid: chosen.tab?.ulid ?? '' }, key),
    onConflict: (message) => {
      onClose();
      onConflict(message);
    },
  });
  const options = list.items.filter((table) =>
    kind === 'transfer' ? table.tab === null : table.tab !== null && table.tab.ulid !== tab.ulid,
  );
  const fieldError = Object.values(action.fieldErrors)[0] ?? null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const moved = await action.send(target);
    if (moved) {
      saveTab(moved);
      // A merge also changes this (source) tab: it is `merged` now.
      if (kind === 'merge') saveTab(null, tab.ulid);
      toast.success(kind === 'merge' ? `Merged into Table ${moved.table.name}'s bill.` : `Moved to Table ${moved.table.name}.`);
      onMoved(moved);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} aria-busy={action.busy}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>{kind === 'transfer' ? `Move table ${tab.table.name}` : `Merge table ${tab.table.name}`}</DialogTitle>
        <DialogDescription>
          {kind === 'transfer'
            ? 'Choose a free table. The bill and its rounds move there.'
            : 'Choose the bill to merge into. Everything not paid here moves to it, without a new kitchen ticket, and the guests are added together.'}
        </DialogDescription>
      </DialogHeader>
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      {fieldError ? <Banner>{fieldError}</Banner> : null}
      {list.loading ? (
        <LoadingRows rows={3} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : options.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground">
          {kind === 'transfer' ? 'No table is free right now.' : 'No other table has an open bill.'}
        </p>
      ) : (
        <ul className="grid max-h-[45dvh] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 overflow-y-auto" role="radiogroup" aria-label="Tables">
          {options.map((table) => {
            const selected = target?.id === table.id;
            return (
              <li key={table.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTarget(table)}
                  disabled={action.busy}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 rounded-lg border border-border bg-card p-3 text-left',
                    selected && 'border-green-line bg-green-soft',
                  )}
                >
                  <span className="text-lg font-bold">{table.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {table.tab
                      ? `${table.tab.guests} ${table.tab.guests === 1 ? 'guest' : 'guests'} · ${formatPeso(table.tab.remaining_cents)}`
                      : `${table.area ? `${table.area} · ` : ''}${table.seats} seats`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <Button type="submit" variant="green" disabled={!target || action.busy}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : kind === 'transfer' ? <ArrowRightLeftIcon aria-hidden="true" /> : <MergeIcon aria-hidden="true" />}
          {action.busy ? 'Saving…' : kind === 'transfer' ? 'Move bill' : 'Merge bills'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The 409 dialog (§I)
// ---------------------------------------------------------------------------

export function TabConflictDialog({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <Dialog open={message !== null} onOpenChange={(next) => (next ? null : onDismiss())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>The bill changed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button autoFocus variant="green" onClick={onDismiss}>
            Reload the bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
