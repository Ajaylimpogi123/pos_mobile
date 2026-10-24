/**
 * Add or edit a supplier (§C, Q-030; `supplier.manage`; back-office.md →
 * Forms): name (required, max 120, unique), contact person (max 120), contact
 * number (max 30), email, address (max 255) and active. `POST` / `PATCH`
 * (changed fields only); 422s under their fields, anything else in a banner.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { usePurchasingPermissions } from '@/hooks/purchasing/usePurchasingPermissions';
import { useSaveSupplier, useSupplier } from '@/hooks/useSuppliers';
import type { Supplier, SupplierCreateRequest, SupplierUpdateRequest } from '@/services/types';
import { looksLikeEmail, nullIfBlank, splitSaveError, tooLong, type FieldErrors } from '@/utils/forms';

const LIMITS = { name: 120, contactPerson: 120, contactNumber: 30, email: 255, address: 255 } as const;
const FIELDS = ['name', 'contact_person', 'contact_number', 'email', 'address', 'is_active'] as const;

type Draft = { name: string; contactPerson: string; contactNumber: string; email: string; address: string; isActive: boolean };

function draftFrom(supplier: Supplier | null): Draft {
  return {
    name: supplier?.name ?? '',
    contactPerson: supplier?.contact_person ?? '',
    contactNumber: supplier?.contact_number ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    isActive: supplier?.is_active ?? true,
  };
}

function check(draft: Draft): { body: SupplierCreateRequest | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  const contactPerson = nullIfBlank(draft.contactPerson);
  const contactNumber = nullIfBlank(draft.contactNumber);
  const email = nullIfBlank(draft.email);
  const address = nullIfBlank(draft.address);
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > LIMITS.name) errors.name = tooLong(LIMITS.name);
  if (contactPerson && contactPerson.length > LIMITS.contactPerson) errors.contact_person = tooLong(LIMITS.contactPerson);
  if (contactNumber && contactNumber.length > LIMITS.contactNumber) errors.contact_number = tooLong(LIMITS.contactNumber);
  if (email && email.length > LIMITS.email) errors.email = tooLong(LIMITS.email);
  else if (email && !looksLikeEmail(email)) errors.email = 'Enter an email like name@example.com.';
  if (address && address.length > LIMITS.address) errors.address = tooLong(LIMITS.address);
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { name, contact_person: contactPerson, contact_number: contactNumber, email, address, is_active: draft.isActive }, errors };
}

function diff(saved: Supplier, body: SupplierCreateRequest): SupplierUpdateRequest {
  const changes: SupplierUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.contact_person ?? null) !== saved.contact_person) changes.contact_person = body.contact_person ?? null;
  if ((body.contact_number ?? null) !== saved.contact_number) changes.contact_number = body.contact_number ?? null;
  if ((body.email ?? null) !== saved.email) changes.email = body.email ?? null;
  if ((body.address ?? null) !== saved.address) changes.address = body.address ?? null;
  if (body.is_active !== undefined && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  return changes;
}

export function SupplierFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = useSupplier(editing ? id : null);
  const { canManageSuppliers } = usePurchasingPermissions();
  useShellHeader(editing ? 'Edit supplier' : 'Add supplier');

  if (!canManageSuppliers) {
    return (
      <EmptyState
        title="You don't have permission to manage suppliers"
        message="Ask a manager if you need access."
        action={
          <Button asChild variant="outline">
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        }
      />
    );
  }
  if (editing && existing.loading) return <LoadingRows rows={6} label="Loading the supplier…" />;
  if (editing && (existing.error || !existing.supplier)) {
    return (
      <PlainPage title="Edit supplier">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <SupplierForm key={existing.supplier?.id ?? 'new'} supplier={editing ? existing.supplier : null} />;
}

function SupplierForm({ supplier }: { supplier: Supplier | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(supplier));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const save = useSaveSupplier(supplier?.id ?? null);
  const server = splitSaveError(save.error, FIELDS);
  const fieldError = (field: (typeof FIELDS)[number]) => clientErrors[field] ?? server.fieldErrors[field] ?? null;

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
    setClientErrors({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const checked = check(draft);
    setClientErrors(checked.errors);
    if (!checked.body) return;
    const body = supplier ? diff(supplier, checked.body) : checked.body;
    if (supplier && Object.keys(body).length === 0) {
      void navigate('/suppliers');
      return;
    }
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.success(supplier ? `${saved.name} saved.` : `${saved.name} added.`);
        void navigate('/suppliers');
      },
    });
  }

  return (
    <PlainPage title={supplier ? `Edit ${supplier.name}` : 'Add supplier'} subtitle="A supplier you buy from.">
      <form onSubmit={onSubmit} noValidate aria-busy={save.isPending} className="w-full max-w-[720px]">
        <ErrorSummary />
        <div className="flex flex-col gap-4">
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          <Card className="flex flex-col gap-5 p-5">
            <h2 className="text-base font-semibold">Details</h2>
            <FormField label="Name" error={fieldError('name')}>
              <Input value={draft.name} maxLength={LIMITS.name} onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Golden Mills" />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Contact person (optional)" error={fieldError('contact_person')}>
                <Input value={draft.contactPerson} maxLength={LIMITS.contactPerson} onChange={(event) => change({ contactPerson: event.target.value })} />
              </FormField>
              <FormField label="Contact number (optional)" error={fieldError('contact_number')}>
                <Input
                  type="tel"
                  value={draft.contactNumber}
                  maxLength={LIMITS.contactNumber}
                  onChange={(event) => change({ contactNumber: event.target.value })}
                  className="tabular"
                />
              </FormField>
            </div>
            <FormField label="Email (optional)" error={fieldError('email')}>
              <Input type="email" value={draft.email} maxLength={LIMITS.email} onChange={(event) => change({ email: event.target.value })} />
            </FormField>
            <FormField label="Address (optional)" error={fieldError('address')}>
              <Textarea value={draft.address} maxLength={LIMITS.address} onChange={(event) => change({ address: event.target.value })} />
            </FormField>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <div>
                <Label htmlFor="supplier-active">Active</Label>
                <p className="text-[13px] text-muted-foreground">Inactive suppliers can't be picked on new purchase requests.</p>
                <FieldError message={fieldError('is_active')} />
              </div>
              <Switch id="supplier-active" checked={draft.isActive} onCheckedChange={(isActive) => change({ isActive })} />
            </div>
          </Card>
          <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
            <Button asChild variant="outline" size="lg">
              <Link to="/suppliers">Cancel</Link>
            </Button>
            <Button type="submit" variant="green" size="lg" disabled={save.isPending}>
              {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </form>
    </PlainPage>
  );
}
