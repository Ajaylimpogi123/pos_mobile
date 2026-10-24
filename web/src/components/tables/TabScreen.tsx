/**
 * The tab screen (Dine-in Tables & Tabs §I): `Table 5 · 3 guests`, then
 *
 * - **Ordering:** the Sell menu and a **New round** cart (the round cart
 *   store): **Send to kitchen** sends it as a round, prints the round's
 *   tickets and clears it. **Bill items** lists what was sent, by round, with
 *   **Cancel** (reason + manager PIN).
 * - **Pay:** the whole bill, by item or equally, in the existing checkout
 *   (the settlement cart store) with the service charge and, for an equal
 *   split, one payment step per share. Receipts print, no kitchen ticket.
 * - **Print bill**, **Guests**, **Transfer**, **Merge** and **Close**.
 *
 * Tab actions need a connection (offline: disabled). A `409` shows in a
 * dialog that reloads the tab; `422`s show on their fields.
 * Keyboard: `/` search, `Enter` adds the highlighted product, `F2` pays.
 */
import {
  ArrowLeftIcon,
  ArrowRightLeftIcon,
  DoorClosedIcon,
  EllipsisIcon,
  MergeIcon,
  PencilIcon,
  ReceiptIcon,
  WifiOffIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { RoundOrderingView, SettlementView } from '@/components/tables/TabViews';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/misc';
import { useCancelTabItem } from '@/hooks/useCancelTabItem';
import { useDineIn } from '@/hooks/useDiningTables';
import { useOnline } from '@/hooks/useOnline';
import { useOrderPrinting } from '@/hooks/useOrderPrinting';
import { useTab, useTabAction, useTabCache, useTabConflict } from '@/hooks/useTab';
import { settlementLine } from '@/sale/tabLines';
import { closeTab } from '@/services/tabs';
import type { Shift, Tab } from '@/services/types';
import { CartStoreContext, useRoundCartStore, useSettleCartStore } from '@/stores/cart';
import { useSessionStore } from '@/stores/session';
import { TABLES_OFFLINE_MESSAGE } from '@/utils/tables';
import { formatBranchTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { tabRemainingLines } from '@pos/core/sale/tab';

import { BillItemsCard } from './BillItemsCard';
import { CancelItemDialog } from './CancelItemDialog';
import { GuestsDialog, MoveTabDialog, PayDialog, TabConflictDialog, type PayChoice } from './TabDialogs';

/** Which tab the round cart and the settlement cart were filled for (the carts outlive the screen). */
const owners: { round: string | null; settle: string | null } = { round: null, settle: null };

type TabScreenProps = {
  tabUlid: string;
  shift: Shift;
  /** Back to the Tables view. */
  onBack: () => void;
  /** Another tab (a merge's target). */
  onOpenTab: (ulid: string) => void;
};

export function TabScreen({ tabUlid, shift, onBack, onOpenTab }: TabScreenProps) {
  const { tab, loading, error, reload } = useTab(tabUlid);
  const conflict = useTabConflict(tabUlid);

  // The round cart belongs to one tab: entering another tab starts an empty round.
  useEffect(() => {
    if (owners.round !== tabUlid) {
      if (!useRoundCartStore.getState().awaitingConfirmation) useRoundCartStore.getState().clear();
      owners.round = tabUlid;
    }
  }, [tabUlid]);

  if (loading) {
    return (
      <Card>
        <LoadingRows rows={5} label="Loading the bill…" />
      </Card>
    );
  }
  if (error || !tab) {
    return (
      <Card>
        <ErrorState title="Couldn't load this bill" message={error ?? 'This bill was not found.'} onRetry={reload} />
        <div className="flex justify-center pb-6">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeftIcon aria-hidden="true" />
            Back to tables
          </Button>
        </div>
      </Card>
    );
  }
  if (tab.status !== 'open') {
    return (
      <Card className="flex flex-col items-start gap-3 p-6">
        <h2 className="text-xl font-bold">Table {tab.table.name}</h2>
        <p>
          {tab.status === 'merged'
            ? 'This bill was merged into another table’s bill.'
            : tab.status === 'cancelled'
              ? 'This bill was closed with nothing to pay.'
              : 'This bill is paid and closed.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {tab.merged_into_ulid ? (
            <Button variant="green" onClick={() => onOpenTab(tab.merged_into_ulid as string)}>
              Open that bill
            </Button>
          ) : null}
          <Button variant="outline" onClick={onBack}>
            <ArrowLeftIcon aria-hidden="true" />
            Back to tables
          </Button>
        </div>
        <TabConflictDialog message={conflict.message} onDismiss={conflict.dismiss} />
      </Card>
    );
  }
  return <OpenTabScreen key={tab.ulid} tab={tab} shift={shift} onBack={onBack} onOpenTab={onOpenTab} conflict={conflict} />;
}

function OpenTabScreen({
  tab,
  shift,
  onBack,
  onOpenTab,
  conflict,
}: {
  tab: Tab;
  shift: Shift;
  onBack: () => void;
  onOpenTab: (ulid: string) => void;
  conflict: ReturnType<typeof useTabConflict>;
}) {
  const online = useOnline();
  const dineIn = useDineIn();
  const timeZone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const saveTab = useTabCache();
  const billPrinting = useOrderPrinting();
  const cancel = useCancelTabItem(tab, conflict.show);
  const roundLines = useRoundCartStore((state) => state.lines.length);
  const [paying, setPaying] = useState(() => owners.settle === tab.ulid && useSettleCartStore.getState().awaitingConfirmation);
  const [payOpen, setPayOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [move, setMove] = useState<'transfer' | 'merge' | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const closeAction = useTabAction({
    run: (key) => closeTab(tab.ulid, key),
    onConflict: (message) => {
      setCloseOpen(false);
      conflict.show(message);
    },
  });
  const searchRef = useRef<HTMLInputElement>(null);

  const remaining = tabRemainingLines(tab);
  const hasRemaining = remaining.length > 0;
  const openedAt = formatBranchTime(tab.opened_at, timeZone);

  function startPay(choice: PayChoice) {
    setPayOpen(false);
    const lines =
      choice.mode === 'items'
        ? remaining.filter((item) => (choice.qty[item.id] ?? 0) > 0).map((item) => settlementLine(item, choice.qty[item.id] ?? 0))
        : remaining.map((item) => settlementLine(item, item.remaining_qty));
    const store = useSettleCartStore.getState();
    store.loadSettlement({
      lines,
      tableNo: tab.table.name,
      serviceCharge: { bps: dineIn.serviceChargeBps, on: true },
      splitCount: choice.mode === 'equal' ? choice.count : null,
    });
    if (tab.customer) store.setCustomer({ id: tab.customer.id, full_name: tab.customer.full_name });
    owners.settle = tab.ulid;
    setPaying(true);
  }

  function requestPay() {
    if (!online || !hasRemaining) return;
    // An unconfirmed payment for this bill is still pending: go back to it (same ULID), don't start over.
    if (owners.settle === tab.ulid && useSettleCartStore.getState().awaitingConfirmation) {
      setPaying(true);
      return;
    }
    setPayOpen(true);
  }

  function requestBack() {
    if (roundLines > 0 && !paying) setLeaveOpen(true);
    else onBack();
  }

  const actionsDisabled = !online;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="outline" onClick={paying ? () => setPaying(false) : requestBack} aria-label={paying ? 'Back to the bill' : 'Back to tables'}>
            <ArrowLeftIcon aria-hidden="true" />
            <span className="hidden sm:inline">{paying ? 'Bill' : 'Tables'}</span>
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">
              Table {tab.table.name} · {tab.guests} {tab.guests === 1 ? 'guest' : 'guests'}
            </h2>
            <p className="truncate text-[13px] text-muted-foreground">
              {tab.table.area ? `${tab.table.area} · ` : ''}Opened {openedAt ? `${openedAt} ` : ''}by {tab.opened_by.name}
              {tab.customer ? ` · ${tab.customer.full_name}` : ''}
            </p>
          </div>
        </div>
        {paying ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void billPrinting.printBill(tab, null)} disabled={actionsDisabled || !hasRemaining || billPrinting.starting}>
              <ReceiptIcon aria-hidden="true" />
              Print bill
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={actionsDisabled} aria-label="More actions for this bill">
                  <EllipsisIcon aria-hidden="true" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setGuestsOpen(true)}>
                  <PencilIcon aria-hidden="true" />
                  Guests and note
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMove('transfer')}>
                  <ArrowRightLeftIcon aria-hidden="true" />
                  Transfer to another table
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMove('merge')}>
                  <MergeIcon aria-hidden="true" />
                  Merge into another bill
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={hasRemaining}
                  onSelect={() => {
                    closeAction.clearMessages();
                    setCloseOpen(true);
                  }}
                >
                  <DoorClosedIcon aria-hidden="true" />
                  {hasRemaining ? 'Close (settle or cancel first)' : 'Close bill'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="green" size="lg" onClick={requestPay} disabled={actionsDisabled || !hasRemaining}>
              {hasRemaining ? `Pay (${formatPeso(tab.remaining_cents)})` : 'Pay'}
              <Kbd className="border-transparent bg-green-hover text-white">F2</Kbd>
            </Button>
          </div>
        )}
      </div>

      {!online ? (
        <Banner variant="warning" title={TABLES_OFFLINE_MESSAGE}>
          <span className="inline-flex items-center gap-1.5">
            <WifiOffIcon className="size-4" aria-hidden="true" />
            Sending rounds, cancelling and paying come back when this computer is online.
          </span>
        </Banner>
      ) : null}

      <PrintJobList tracker={billPrinting.tracker} notices={billPrinting.notices} title="Bill printing" />
      <PrintJobList tracker={cancel.printing.tracker} notices={cancel.printing.notices} unrouted={cancel.printing.unrouted} title="Cancel tickets" />

      {paying ? (
        <CartStoreContext.Provider value={useSettleCartStore}>
          <SettlementView
            tab={tab}
            shift={shift}
            onConflict={(message) => {
              if (!useSettleCartStore.getState().awaitingConfirmation) useSettleCartStore.getState().clear();
              setPaying(false);
              conflict.show(message);
            }}
            onSettledTab={(updated) => saveTab(updated, tab.ulid)}
            onDone={(closed) => {
              setPaying(false);
              if (closed) onBack();
            }}
          />
        </CartStoreContext.Provider>
      ) : (
        <CartStoreContext.Provider value={useRoundCartStore}>
          <RoundOrderingView
            tab={tab}
            online={online}
            searchRef={searchRef}
            onPay={requestPay}
            onConflict={conflict.show}
            billItems={<BillItemsCard tab={tab} onCancel={online ? cancel.open : null} />}
          />
        </CartStoreContext.Provider>
      )}

      <CancelItemDialog state={cancel} />
      <PayDialog tab={tab} open={payOpen} onClose={() => setPayOpen(false)} onContinue={startPay} />
      <GuestsDialog tab={tab} open={guestsOpen} onClose={() => setGuestsOpen(false)} onConflict={conflict.show} />
      <MoveTabDialog
        tab={tab}
        kind={move}
        onClose={() => setMove(null)}
        onConflict={conflict.show}
        onMoved={(moved) => {
          setMove(null);
          if (moved.ulid !== tab.ulid) onOpenTab(moved.ulid);
        }}
      />
      <ConfirmDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={`Close table ${tab.table.name}`}
        description="Nothing is left to pay on this bill. Closing it frees the table."
        confirmLabel="Close bill"
        pendingLabel="Closing…"
        pending={closeAction.busy}
        error={closeAction.banner}
        destructive={false}
        onConfirm={() => {
          void closeAction.send(undefined).then((closed) => {
            if (!closed) return;
            saveTab(closed);
            setCloseOpen(false);
            onBack();
          });
        }}
      />
      <ConfirmDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Items not sent to the kitchen"
        description={`${roundLines} ${roundLines === 1 ? 'line is' : 'lines are'} in the new round. Send them first, or discard them.`}
        confirmLabel="Discard and leave"
        pendingLabel="Leaving…"
        pending={false}
        error={null}
        onConfirm={() => {
          useRoundCartStore.getState().clear();
          setLeaveOpen(false);
          onBack();
        }}
      />
      <TabConflictDialog message={conflict.message} onDismiss={conflict.dismiss} />
    </div>
  );
}
