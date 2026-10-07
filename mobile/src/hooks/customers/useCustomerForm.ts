import { useCustomerMutations } from '@/hooks/customers/useCustomers';
import { looksLikeEmail, nullIfBlank, type FieldErrors } from '@/hooks/forms/formErrors';
import { useRecordForm } from '@/hooks/forms/useRecordForm';
import type { Customer, CustomerCreateRequest, CustomerUpdateRequest } from '@/services/types';

/** Request fields of POST/PATCH /api/v1/customers. */
export type CustomerField = 'first_name' | 'last_name' | 'contact' | 'email' | 'notes';

export const CUSTOMER_FIELDS: readonly CustomerField[] = ['first_name', 'last_name', 'contact', 'email', 'notes'];

export type CustomerFormValues = {
  firstName: string;
  lastName: string;
  contact: string;
  email: string;
  notes: string;
};

const FIELD_OF: { [K in keyof CustomerFormValues]: CustomerField } = {
  firstName: 'first_name',
  lastName: 'last_name',
  contact: 'contact',
  email: 'email',
  notes: 'notes',
};

/** Contract limits. */
export const CUSTOMER_LIMITS = { firstName: 60, lastName: 60, contact: 30, email: 255, notes: 500 } as const;

/** Contract: digits, spaces, and + ( ) - only. */
const CONTACT_PATTERN = /^[0-9+()\-\s]+$/;

export function customerToValues(customer?: Customer): CustomerFormValues {
  return {
    firstName: customer?.first_name ?? '',
    lastName: customer?.last_name ?? '',
    contact: customer?.contact ?? '',
    email: customer?.email ?? '',
    notes: customer?.notes ?? '',
  };
}

function tooLong(limit: number): string {
  return `Use ${limit} characters or fewer.`;
}

export function validateCustomer(values: CustomerFormValues): {
  body: CustomerCreateRequest | null;
  errors: FieldErrors<CustomerField>;
} {
  const errors: FieldErrors<CustomerField> = {};
  const firstName = values.firstName.trim();
  const lastName = nullIfBlank(values.lastName);
  const contact = nullIfBlank(values.contact);
  const email = nullIfBlank(values.email);
  const notes = nullIfBlank(values.notes);

  if (firstName === '') errors.first_name = 'Enter a first name.';
  else if (firstName.length > CUSTOMER_LIMITS.firstName) errors.first_name = tooLong(CUSTOMER_LIMITS.firstName);
  if (lastName !== null && lastName.length > CUSTOMER_LIMITS.lastName) errors.last_name = tooLong(CUSTOMER_LIMITS.lastName);
  if (contact !== null && contact.length > CUSTOMER_LIMITS.contact) errors.contact = tooLong(CUSTOMER_LIMITS.contact);
  else if (contact !== null && !CONTACT_PATTERN.test(contact)) {
    errors.contact = 'Use only digits, spaces and + ( ) -.';
  }
  if (email !== null && email.length > CUSTOMER_LIMITS.email) errors.email = tooLong(CUSTOMER_LIMITS.email);
  else if (email !== null && !looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
  if (notes !== null && notes.length > CUSTOMER_LIMITS.notes) errors.notes = tooLong(CUSTOMER_LIMITS.notes);

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { first_name: firstName, last_name: lastName, contact, email, notes }, errors };
}

/** Only the fields that differ from the saved customer (PATCH is partial). */
export function diffCustomer(saved: Customer, body: CustomerCreateRequest): CustomerUpdateRequest {
  const changes: CustomerUpdateRequest = {};
  const email = body.email ?? null;
  if (body.first_name !== saved.first_name) changes.first_name = body.first_name;
  if ((body.last_name ?? null) !== saved.last_name) changes.last_name = body.last_name ?? null;
  if ((body.contact ?? null) !== saved.contact) changes.contact = body.contact ?? null;
  // The server stores email lowercased: only a real change is sent.
  if (email?.toLowerCase() !== saved.email?.toLowerCase()) changes.email = email;
  if ((body.notes ?? null) !== saved.notes) changes.notes = body.notes ?? null;
  return changes;
}

type UseCustomerFormOptions = {
  initial?: Customer;
  onSaved: (customer: Customer) => void;
  onDeleted: () => void;
};

/** Create / edit / delete a customer (POST, PATCH, DELETE /api/v1/customers). */
export function useCustomerForm({ initial, onSaved, onDeleted }: UseCustomerFormOptions) {
  const mutations = useCustomerMutations();

  return useRecordForm<CustomerFormValues, CustomerField, Customer, CustomerCreateRequest, CustomerUpdateRequest>({
    initial,
    toValues: customerToValues,
    validate: validateCustomer,
    diff: diffCustomer,
    fields: CUSTOMER_FIELDS,
    fieldOf: FIELD_OF,
    create: mutations.create,
    update: mutations.update,
    remove: mutations.remove,
    onSaved: (customer) => onSaved(customer),
    onDeleted,
  });
}

export type CustomerFormState = ReturnType<typeof useCustomerForm>;
