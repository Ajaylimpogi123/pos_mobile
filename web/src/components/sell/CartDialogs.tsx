/**
 * The cart's dialogs (the tablet's editors, as shadcn dialogs): line editor
 * (quantity, line discount, kitchen note), order discount, table number,
 * customer search, and the clear confirmation. `Esc` closes each one.
 * Dine-in: the line editor of a round has no discount, and a settlement line
 * keeps its kitchen note (it was already sent).
 */
import { LoaderCircleIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import type { CartEditors } from '@/hooks/sell/useCartEditors';
import { useCursorList } from '@/hooks/useCursorList';
import { priceCart } from '@pos/core/sale/order';
import { TABLE_NO_MAX } from '@pos/core/sale/table';
import { listCustomers } from '@/services/customers';
import { CART_LIMITS, useActiveCartStore } from '@/stores/cart';
import { formatPeso } from '@pos/core/money';

import { DiscountFields } from './SellParts';

/** `round`: a dine-in round (no discounts); `settle`: a tab's line at Pay (no note). */
export type CartVariant = 'sale' | 'round' | 'settle';

export function LineEditorDialog({ editors, variant = 'sale' }: { editors: CartEditors; variant?: CartVariant }) {
  const draft = editors.lineDraft;
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : editors.cancelLine())}>
      <DialogContent>
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              editors.saveLine();
            }}
          >
            <ErrorSummary />
            <DialogHeader>
              <DialogTitle>{draft.name}</DialogTitle>
              <DialogDescription>{formatPeso(draft.unitPriceCents)} each</DialogDescription>
            </DialogHeader>
            <FormField label="Quantity" error={draft.errors.qty}>
              <Input
                inputMode="numeric"
                value={draft.qty}
                onChange={(event) => editors.changeLineDraft({ qty: event.target.value })}
                className="w-32 tabular"
              />
            </FormField>
            {variant === 'round' ? null : draft.discountLock ? (
              <Badge tone="neutral" className="w-fit">
                {draft.discountLock}
              </Badge>
            ) : (
              <DiscountFields
                draft={draft.discount}
                onChange={(discount) => editors.changeLineDraft({ discount })}
                error={draft.errors.discount ?? null}
                toggleLabel="Line discount"
              />
            )}
            {variant === 'settle' ? null : (
              <FormField label="Note for the kitchen (optional)" hint={`Up to ${CART_LIMITS.lineNotesMax} characters.`}>
                <Textarea
                  value={draft.notes}
                  maxLength={CART_LIMITS.lineNotesMax}
                  placeholder="e.g. No ketchup"
                  onChange={(event) => editors.changeLineDraft({ notes: event.target.value })}
                />
              </FormField>
            )}
            <DialogFooter className="sm:justify-between">
              <Button variant="destructive" onClick={editors.removeDraftLine}>
                Remove
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={editors.cancelLine}>
                  Cancel
                </Button>
                <Button type="submit" variant="green" size="lg">
                  Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function OrderDiscountDialog({ editors }: { editors: CartEditors }) {
  const draft = editors.orderDraft;
  const useStore = useActiveCartStore();
  const lines = useStore((state) => state.lines);
  const current = useStore((state) => state.orderDiscount);
  const base = priceCart(lines, null).discount_base_cents;
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : editors.cancelOrderDiscount())}>
      <DialogContent>
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              editors.saveOrderDiscount();
            }}
          >
            <ErrorSummary />
            <DialogHeader>
              <DialogTitle>Order discount</DialogTitle>
              <DialogDescription>Applies to {formatPeso(base)}, after any line discounts.</DialogDescription>
            </DialogHeader>
            <DiscountFields draft={draft.discount} onChange={editors.changeOrderDraft} error={draft.error} />
            <DialogFooter className="sm:justify-between">
              {current ? (
                <Button variant="destructive" onClick={editors.removeOrderDiscount}>
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={editors.cancelOrderDiscount}>
                  Cancel
                </Button>
                <Button type="submit" variant="green" size="lg">
                  Apply
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function TableDialog({ editors }: { editors: CartEditors }) {
  const draft = editors.tableDraft;
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : editors.cancelTable())}>
      <DialogContent className="max-w-sm">
        {draft ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              editors.saveTable();
            }}
          >
            <ErrorSummary />
            <DialogHeader>
              <DialogTitle>Table number</DialogTitle>
              <DialogDescription>Optional. Printed large on the kitchen ticket.</DialogDescription>
            </DialogHeader>
            <FormField label="Table" error={draft.error} hint="Letters, numbers, spaces and hyphens, e.g. 12, A3 or Patio 2.">
              <Input
                autoFocus
                autoComplete="off"
                maxLength={TABLE_NO_MAX + 5}
                value={draft.text}
                onChange={(event) => editors.changeTable(event.target.value)}
              />
            </FormField>
            <DialogFooter className="sm:justify-between">
              <Button variant="destructive" onClick={editors.clearTable}>
                No table
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={editors.cancelTable}>
                  Cancel
                </Button>
                <Button type="submit" variant="green" size="lg">
                  Save
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function CustomerDialog({ editors }: { editors: CartEditors }) {
  const open = editors.customerPickerOpen;
  const useStore = useActiveCartStore();
  const current = useStore((state) => state.customer);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);
  const list = useCursorList(['customers', 'search', search], (cursor) => listCustomers({ search: search || undefined, cursor, per_page: 25 }), {
    enabled: open,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? editors.openCustomerPicker() : editors.closeCustomerPicker())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Customer</DialogTitle>
          <DialogDescription>Search by name, email or phone number.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} role="search">
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="customer-search"
              autoFocus
              value={term}
              maxLength={100}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="e.g. Maria or 0917 123 4567"
              className="pl-9"
            />
          </div>
        </form>
        {current ? (
          <Banner
            variant="info"
            actions={
              <Button variant="outline" size="sm" onClick={() => editors.chooseCustomer(null)}>
                Remove
              </Button>
            }
          >
            Attached: {current.full_name}
          </Banner>
        ) : null}
        <div className="max-h-[50dvh] overflow-y-auto rounded-lg border border-border">
          {list.loading ? (
            <LoadingRows rows={4} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.retry} />
          ) : list.items.length === 0 ? (
            <EmptyState
              title={search ? 'No customers match' : 'No customers yet'}
              message={search ? 'Try another name or number.' : 'Customers are added in the back-office.'}
            />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {list.items.map((customer) => (
                  <li key={customer.id}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start px-4 py-3 text-left hover:bg-row-hover"
                      onClick={() => editors.chooseCustomer({ id: customer.id, full_name: customer.full_name })}
                    >
                      <span className="font-medium">{customer.full_name}</span>
                      <span className="text-[13px] text-muted-foreground">
                        {[customer.contact, customer.email].filter(Boolean).join(' · ') || 'No contact details'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <LoadMoreFooter
                shown={list.items.length}
                hasMore={list.hasMore}
                loading={list.loadingMore}
                onLoadMore={list.loadMore}
                error={list.loadMoreError}
                noun="customers"
              />
            </>
          )}
        </div>
        {list.refreshing && !list.loading ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
            <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
            Searching…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ClearCartDialog({ editors }: { editors: CartEditors }) {
  const useStore = useActiveCartStore();
  const awaiting = useStore((state) => state.awaitingConfirmation);
  return (
    <Dialog open={editors.clearOpen} onOpenChange={(open) => (open ? null : editors.cancelClear())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear the cart?</DialogTitle>
          <DialogDescription>Every line, discount, customer and table number is removed.</DialogDescription>
        </DialogHeader>
        {awaiting ? (
          <Banner variant="warning">
            The last attempt may have gone through. Check Order History before charging this sale again.
          </Banner>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={editors.cancelClear}>
            Keep the cart
          </Button>
          <Button variant="destructiveSolid" onClick={editors.confirmClear}>
            Clear cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
