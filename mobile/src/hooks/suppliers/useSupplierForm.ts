import { looksLikeEmail, nullIfBlank, type FieldErrors } from '@/hooks/forms/formErrors';
import { useRecordForm } from '@/hooks/forms/useRecordForm';
import { useSupplierMutations } from '@/hooks/suppliers/useSuppliers';
import type { Supplier, SupplierCreateRequest, SupplierUpdateRequest } from '@/services/types';

/** Request fields of POST/PATCH /api/v1/admin/suppliers. */
export type SupplierField = 'name' | 'contact_person' | 'contact_number' | 'email' | 'address' | 'is_active';

export const SUPPLIER_FIELDS: readonly SupplierField[] = ['name', 'contact_person', 'contact_number', 'email', 'address', 'is_active'];

export type SupplierFormValues = {
  name: string;
  contactPerson: string;
  contactNumber: string;
  email: string;
  address: string;
  isActive: boolean;
};

const FIELD_OF: { [K in keyof SupplierFormValues]: SupplierField } = {
  name: 'name',
  contactPerson: 'contact_person',
  contactNumber: 'contact_number',
  email: 'email',
  address: 'address',
  isActive: 'is_active',
};

/**
 * Contract limits (§C): name max 120, contact number max 30, address max 255.
 * The contact person and email have no stated limit; 255 (Laravel's string
 * column) is used as a UI cap only.
 */
export const SUPPLIER_LIMITS = { name: 120, contactPerson: 255, contactNumber: 30, email: 255, address: 255 } as const;

export function supplierToValues(supplier?: Supplier): SupplierFormValues {
  return {
    name: supplier?.name ?? '',
    contactPerson: supplier?.contact_person ?? '',
    contactNumber: supplier?.contact_number ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    isActive: supplier?.is_active ?? true,
  };
}

function tooLong(limit: number): string {
  return `Use ${limit} characters or fewer.`;
}

export function validateSupplier(values: SupplierFormValues): { body: SupplierCreateRequest | null; errors: FieldErrors<SupplierField> } {
  const errors: FieldErrors<SupplierField> = {};
  const name = values.name.trim();
  const contactPerson = nullIfBlank(values.contactPerson);
  const contactNumber = nullIfBlank(values.contactNumber);
  const email = nullIfBlank(values.email);
  const address = nullIfBlank(values.address);

  if (name === '') errors.name = 'Enter the supplier name.';
  else if (name.length > SUPPLIER_LIMITS.name) errors.name = tooLong(SUPPLIER_LIMITS.name);
  if (contactPerson !== null && contactPerson.length > SUPPLIER_LIMITS.contactPerson) errors.contact_person = tooLong(SUPPLIER_LIMITS.contactPerson);
  if (contactNumber !== null && contactNumber.length > SUPPLIER_LIMITS.contactNumber) errors.contact_number = tooLong(SUPPLIER_LIMITS.contactNumber);
  if (email !== null && email.length > SUPPLIER_LIMITS.email) errors.email = tooLong(SUPPLIER_LIMITS.email);
  else if (email !== null && !looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
  if (address !== null && address.length > SUPPLIER_LIMITS.address) errors.address = tooLong(SUPPLIER_LIMITS.address);

  if (Object.keys(errors).length > 0) return { body: null, errors };
  return {
    body: { name, contact_person: contactPerson, contact_number: contactNumber, email, address, is_active: values.isActive },
    errors,
  };
}

/** Only the fields that differ (PATCH is partial). */
export function diffSupplier(saved: Supplier, body: SupplierCreateRequest): SupplierUpdateRequest {
  const changes: SupplierUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.contact_person ?? null) !== saved.contact_person) changes.contact_person = body.contact_person ?? null;
  if ((body.contact_number ?? null) !== saved.contact_number) changes.contact_number = body.contact_number ?? null;
  if ((body.email ?? null)?.toLowerCase() !== saved.email?.toLowerCase()) changes.email = body.email ?? null;
  if ((body.address ?? null) !== saved.address) changes.address = body.address ?? null;
  if (body.is_active !== undefined && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  return changes;
}

/** Create / edit / delete a supplier (`supplier.manage`). A 409 on delete shows in the banner. */
export function useSupplierForm({ initial, onSaved, onDeleted }: { initial?: Supplier; onSaved: () => void; onDeleted: () => void }) {
  const mutations = useSupplierMutations();
  return useRecordForm<SupplierFormValues, SupplierField, Supplier, SupplierCreateRequest, SupplierUpdateRequest>({
    initial,
    toValues: supplierToValues,
    validate: validateSupplier,
    diff: diffSupplier,
    fields: SUPPLIER_FIELDS,
    fieldOf: FIELD_OF,
    create: mutations.create,
    update: mutations.update,
    remove: mutations.remove,
    onSaved: () => onSaved(),
    onDeleted,
  });
}

export type SupplierFormState = ReturnType<typeof useSupplierForm>;
