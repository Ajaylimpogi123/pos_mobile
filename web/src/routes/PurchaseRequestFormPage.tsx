/**
 * New or edit a purchase request (§F, §L; `purchase.request`; edit by the
 * requester or `purchase.approve` while no item is decided). Back-office.md →
 * Forms. The date needed, remarks, and 1–100 items, each with an ingredient
 * (active only), a supplier, a quantity in a valid unit (with its base
 * preview), an optional estimated price per unit (and the estimated line
 * total, exact `BigInt` math) and remarks. 422s land under their row
 * (`items.3.qty`). A create keeps its ULID until the 201 (Retry after a
 * timeout); an edit refused with 409 shows the server's message.
 */
import { LoaderCircleIcon, PlusIcon, RotateCwIcon, TrashIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { ItemPickerDialog, SupplierPickerDialog } from '@/components/purchasing/PurchasePickers';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { QtyUnitField } from '@/components/units/QtyUnitField';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, MoneyInput, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PR_LIMITS, usePurchaseRequestForm, type PurchaseRequestFormState } from '@/hooks/purchasing/usePurchaseRequestForm';
import { isUndecided, usePurchaseRequest } from '@/hooks/purchasing/usePurchaseRequests';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import type { PurchaseRequest } from '@/services/types';
import { formatPeso, parsePesoInput } from '@pos/core/money';
import { lineTotalCents, parseQtyInput } from '@pos/core/quantity';

export function PurchaseRequestFormPage() {
  const params = useParams();
  const ulid = params.ulid ?? null;
  const existing = usePurchaseRequest(ulid);
  const permissions = usePurchasingPermissions();
  useShellHeader(ulid ? 'Edit purchase request' : 'New purchase request');

  const back = (
    <Button asChild variant="outline">
      <Link to={ulid ? `/purchasing/requests/${ulid}` : '/purchasing/requests'}>Back</Link>
    </Button>
  );

  if (ulid === null && !permissions.canRequest) {
    return <EmptyState title="You don't have permission to request purchases" message="Ask a manager if you need access." action={back} />;
  }
  if (ulid !== null && existing.loading) return <LoadingRows rows={8} label="Loading the request…" />;
  if (ulid !== null && (existing.error || !existing.pr)) {
    return (
      <PlainPage title="Edit purchase request">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  if (existing.pr && !(permissions.canApprove || (existing.pr.requested_by.id === permissions.userId && permissions.canRequest))) {
    return <EmptyState title="You can't edit this request" message="Only the requester or an approver can edit it." action={back} />;
  }
  if (existing.pr && !isUndecided(existing.pr)) {
    return <EmptyState title="This request can't be edited" message="This request is already being reviewed." action={back} />;
  }
  return <PurchaseRequestForm key={existing.pr?.ulid ?? 'new'} initial={existing.pr} />;
}

function PurchaseRequestForm({ initial }: { initial: PurchaseRequest | null }) {
  const navigate = useNavigate();
  const form = usePurchaseRequestForm({
    initial,
    onSaved: (pr) => {
      toast.success(initial ? `${pr.pr_no} saved.` : `${pr.pr_no} was created.`);
      void navigate(`/purchasing/requests/${pr.ulid}`);
    },
  });
  const [picking, setPicking] = useState<{ kind: 'item' | 'supplier'; index: number } | null>(null);
  const disabled = form.busy || form.locked;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    form.submit();
  }

  return (
    <PlainPage
      title={initial ? `Edit ${initial.pr_no}` : 'New purchase request'}
      subtitle="Each item goes to an approver, who approves or declines it on its own."
    >
      <form onSubmit={onSubmit} noValidate aria-busy={form.busy} className="w-full max-w-[960px]">
        <ErrorSummary />
        <div className="flex flex-col gap-4">
          {form.banner ? <Banner>{form.banner}</Banner> : null}

          <Card className="flex flex-col gap-5 p-5">
            <h2 className="text-base font-semibold">Request</h2>
            <FormField label="Date needed (optional)" error={form.errors.date_needed} className="max-w-[240px]">
              <Input type="date" value={form.values.dateNeeded} onChange={(event) => form.setDateNeeded(event.target.value)} disabled={disabled} />
            </FormField>
            <FormField label="Remarks (optional)" error={form.errors.remarks}>
              <Textarea value={form.values.remarks} maxLength={PR_LIMITS.remarks} onChange={(event) => form.setRemarks(event.target.value)} disabled={disabled} />
            </FormField>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Items</h2>
                <p className="text-[13px] text-muted-foreground">Up to {PR_LIMITS.items} items, each with its own supplier.</p>
              </div>
              <Button type="button" variant="outline" onClick={form.addItem} disabled={disabled || form.full}>
                <PlusIcon aria-hidden="true" />
                Add item
              </Button>
            </div>
            <FieldError message={form.errors.items} />
            {form.values.items.map((draft, index) => (
              <ItemRow key={draft.key} form={form} index={index} disabled={disabled} onPick={(kind) => setPicking({ kind, index })} />
            ))}
          </Card>

          <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
            <Button asChild variant="outline" size="lg">
              <Link to={initial ? `/purchasing/requests/${initial.ulid}` : '/purchasing/requests'}>Cancel</Link>
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={form.busy}>
              {form.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : form.locked ? <RotateCwIcon aria-hidden="true" /> : null}
              {form.busy ? 'Saving…' : form.locked ? 'Retry' : initial ? 'Save' : 'Submit request'}
            </Button>
          </div>
        </div>
      </form>

      <ItemPickerDialog
        open={picking?.kind === 'item'}
        onClose={() => setPicking(null)}
        onPick={(option) => {
          if (picking) form.pickItem(picking.index, option);
        }}
      />
      <SupplierPickerDialog
        open={picking?.kind === 'supplier'}
        onClose={() => setPicking(null)}
        onPick={(supplier) => {
          if (picking) form.pickSupplier(picking.index, supplier);
        }}
      />
    </PlainPage>
  );
}

function ItemRow({
  form,
  index,
  disabled,
  onPick,
}: {
  form: PurchaseRequestFormState;
  index: number;
  disabled: boolean;
  onPick: (kind: 'item' | 'supplier') => void;
}) {
  const draft = form.values.items[index];
  if (!draft) return null;
  const at = `items.${index}`;
  const error = (field: string) => form.errors[`${at}.${field}`] ?? null;
  const choices = form.choicesOf(draft);
  const qty = parseQtyInput(draft.qty);
  const price = draft.price.trim() === '' ? null : parsePesoInput(draft.price);
  const estimate = qty.ok && price !== null ? lineTotalCents(price, qty.value) : null;
  const itemError = error('item_id') ?? error('item_type');

  return (
    <section aria-label={`Item ${index + 1}`} className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Item {index + 1}</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => form.removeItem(draft.key)}
          disabled={disabled || form.values.items.length <= 1}
          aria-label={`Remove item ${index + 1}${draft.name ? `, ${draft.name}` : ''}`}
        >
          <TrashIcon aria-hidden="true" />
          Remove
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pr-${draft.key}-item`}>Ingredient</Label>
          <Button
            id={`pr-${draft.key}-item`}
            type="button"
            variant="outline"
            className="h-10 justify-start"
            onClick={() => onPick('item')}
            disabled={disabled}
            aria-invalid={itemError ? true : undefined}
          >
            {draft.name || 'Choose an ingredient'}
            {draft.type === 'product' ? <span className="text-muted-foreground">(own-stock item)</span> : null}
          </Button>
          <FieldError message={itemError} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pr-${draft.key}-supplier`}>Supplier</Label>
          <Button
            id={`pr-${draft.key}-supplier`}
            type="button"
            variant="outline"
            className="h-10 justify-start"
            onClick={() => onPick('supplier')}
            disabled={disabled}
            aria-invalid={error('supplier_id') ? true : undefined}
          >
            {draft.supplier?.name ?? 'Choose a supplier'}
          </Button>
          <FieldError message={error('supplier_id')} />
        </div>
        <QtyUnitField
          label="Quantity"
          qty={draft.qty}
          unit={draft.unit}
          choices={choices}
          onQty={(text) => form.setQty(index, text)}
          onUnit={(code) => form.setUnit(index, code)}
          qtyError={error('qty')}
          unitError={error('unit')}
          disabled={disabled || draft.type === null}
        />
        <FormField
          label={`Estimated price per ${draft.unit || 'unit'} (optional)`}
          error={error('estimated_unit_price_cents')}
          hint={estimate !== null ? `Estimated total ${formatPeso(estimate)}` : undefined}
        >
          <MoneyInput value={draft.price} placeholder="0.00" onChange={(event) => form.setPrice(index, event.target.value)} disabled={disabled} />
        </FormField>
      </div>
      <FormField label="Item remarks (optional)" error={error('remarks')}>
        <Input value={draft.remarks} maxLength={PR_LIMITS.itemRemarks} onChange={(event) => form.setItemRemarks(index, event.target.value)} disabled={disabled} />
      </FormField>
    </section>
  );
}
