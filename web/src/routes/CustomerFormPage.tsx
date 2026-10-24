/**
 * Add or edit a customer (Staff & Customers → Customer endpoints,
 * `sale.create`; back-office.md → Forms): first and last name, contact
 * (digits, spaces and + ( ) -), email and notes. `POST` / `PATCH` (changed
 * fields only); 422 messages under their fields, anything else in the banner.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { CONTACT_PATTERN, CUSTOMER_LIMITS, useCustomer, useSaveCustomer } from '@/hooks/useCustomers';
import type { Customer, CustomerCreateRequest, CustomerUpdateRequest } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { looksLikeEmail, nullIfBlank, splitSaveError, tooLong, type FieldErrors } from '@/utils/forms';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

const FIELDS = ['first_name', 'last_name', 'contact', 'email', 'notes'] as const;

type Draft = { firstName: string; lastName: string; contact: string; email: string; notes: string };

function draftFrom(customer: Customer | null): Draft {
  return {
    firstName: customer?.first_name ?? '',
    lastName: customer?.last_name ?? '',
    contact: customer?.contact ?? '',
    email: customer?.email ?? '',
    notes: customer?.notes ?? '',
  };
}

function check(draft: Draft): { body: CustomerCreateRequest | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const firstName = draft.firstName.trim();
  const lastName = nullIfBlank(draft.lastName);
  const contact = nullIfBlank(draft.contact);
  const email = nullIfBlank(draft.email);
  const notes = nullIfBlank(draft.notes);
  if (firstName === '') errors.first_name = 'Enter a first name.';
  else if (firstName.length > CUSTOMER_LIMITS.firstName) errors.first_name = tooLong(CUSTOMER_LIMITS.firstName);
  if (lastName !== null && lastName.length > CUSTOMER_LIMITS.lastName) errors.last_name = tooLong(CUSTOMER_LIMITS.lastName);
  if (contact !== null && contact.length > CUSTOMER_LIMITS.contact) errors.contact = tooLong(CUSTOMER_LIMITS.contact);
  else if (contact !== null && !CONTACT_PATTERN.test(contact)) errors.contact = 'Use only digits, spaces and + ( ) -.';
  if (email !== null && email.length > CUSTOMER_LIMITS.email) errors.email = tooLong(CUSTOMER_LIMITS.email);
  else if (email !== null && !looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
  if (notes !== null && notes.length > CUSTOMER_LIMITS.notes) errors.notes = tooLong(CUSTOMER_LIMITS.notes);
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { first_name: firstName, last_name: lastName, contact, email, notes }, errors };
}

function diff(saved: Customer, body: CustomerCreateRequest): CustomerUpdateRequest {
  const changes: CustomerUpdateRequest = {};
  if (body.first_name !== saved.first_name) changes.first_name = body.first_name;
  if ((body.last_name ?? null) !== saved.last_name) changes.last_name = body.last_name ?? null;
  if ((body.contact ?? null) !== saved.contact) changes.contact = body.contact ?? null;
  // The server stores email lowercased: only a real change is sent.
  if ((body.email ?? null)?.toLowerCase() !== saved.email?.toLowerCase()) changes.email = body.email ?? null;
  if ((body.notes ?? null) !== saved.notes) changes.notes = body.notes ?? null;
  return changes;
}

export function CustomerFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const user = useSessionStore((state) => state.user);
  const canEdit = hasPermission(user, PERMISSIONS.saleCreate);
  const existing = useCustomer(editing && canEdit ? id : null);
  useShellHeader(editing ? 'Edit customer' : 'Add customer');

  if (!canEdit) {
    return (
      <EmptyState
        title="You don't have permission to change customers"
        message="Adding and editing customers needs the permission to make sales. Ask a manager."
      />
    );
  }
  if (editing && existing.loading) return <LoadingRows rows={5} label="Loading the customer…" />;
  if (editing && (existing.error || !existing.customer)) {
    return (
      <PlainPage title="Edit customer">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <CustomerForm key={existing.customer?.id ?? 'new'} customer={editing ? existing.customer : null} />;
}

function CustomerForm({ customer }: { customer: Customer | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(customer));
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const save = useSaveCustomer(customer?.id ?? null);
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
    const body = customer ? diff(customer, checked.body) : checked.body;
    if (customer && Object.keys(body).length === 0) {
      void navigate('/customers');
      return;
    }
    save.mutate(body, {
      onSuccess: (saved) => {
        toast.success(customer ? `${saved.full_name} saved.` : `${saved.full_name} added.`);
        void navigate('/customers');
      },
    });
  }

  return (
    <PlainPage title={customer ? `Edit ${customer.full_name}` : 'Add customer'} subtitle="A customer you can attach to a sale.">
      <form className="w-full max-w-[720px]" onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
        <ErrorSummary />
        <Card className="flex flex-col gap-5 p-5">
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First name" error={fieldError('first_name')}>
              <Input value={draft.firstName} maxLength={CUSTOMER_LIMITS.firstName} onChange={(event) => change({ firstName: event.target.value })} />
            </FormField>
            <FormField label="Last name (optional)" error={fieldError('last_name')}>
              <Input value={draft.lastName} maxLength={CUSTOMER_LIMITS.lastName} onChange={(event) => change({ lastName: event.target.value })} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Contact number (optional)" error={fieldError('contact')} hint="Digits, spaces and + ( ) -.">
              <Input
                type="tel"
                inputMode="tel"
                value={draft.contact}
                maxLength={CUSTOMER_LIMITS.contact}
                onChange={(event) => change({ contact: event.target.value })}
                placeholder="e.g. 0917 123 4567"
                className="tabular"
              />
            </FormField>
            <FormField label="Email (optional)" error={fieldError('email')}>
              <Input type="email" value={draft.email} maxLength={CUSTOMER_LIMITS.email} onChange={(event) => change({ email: event.target.value })} />
            </FormField>
          </div>
          <FormField label="Notes (optional)" error={fieldError('notes')}>
            <Textarea
              value={draft.notes}
              maxLength={CUSTOMER_LIMITS.notes}
              onChange={(event) => change({ notes: event.target.value })}
              placeholder="e.g. Prefers less rice"
            />
          </FormField>
        </Card>
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          <Button asChild variant="outline" size="lg">
            <Link to="/customers">Cancel</Link>
          </Button>
          <Button type="submit" variant="green" size="lg" disabled={save.isPending}>
            {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </PlainPage>
  );
}
