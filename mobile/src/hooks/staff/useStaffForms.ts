import { looksLikeEmail, type FieldErrors } from '@/hooks/forms/formErrors';
import { useRecordForm } from '@/hooks/forms/useRecordForm';
import {
  isPinFormatValid,
  passwordProblem,
  PIN_FORMAT_MESSAGE,
  STAFF_LIMITS,
} from '@/hooks/staff/staffRules';
import { useStaffMutations } from '@/hooks/staff/useStaff';
import type { StaffCreateRequest, StaffUpdateRequest, StaffUser } from '@/services/types';

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

function checkName(name: string): string | null {
  if (name === '') return 'Enter a name.';
  if (name.length > STAFF_LIMITS.name) return `Use ${STAFF_LIMITS.name} characters or fewer.`;
  return null;
}

function checkEmail(email: string): string | null {
  if (email === '') return 'Enter an email address.';
  if (email.length > STAFF_LIMITS.email) return `Use ${STAFF_LIMITS.email} characters or fewer.`;
  if (!looksLikeEmail(email)) return 'Enter a valid email address.';
  return null;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/** Request fields of POST /api/v1/admin/users that have an input. */
export type StaffCreateField = 'name' | 'email' | 'password' | 'role_id' | 'is_active' | 'pin';

export const STAFF_CREATE_FIELDS: readonly StaffCreateField[] = ['name', 'email', 'password', 'role_id', 'is_active', 'pin'];

export type StaffCreateValues = {
  name: string;
  email: string;
  password: string;
  roleId: number | null;
  isActive: boolean;
  /** Optional; blank = no PIN. */
  pin: string;
};

const CREATE_FIELD_OF: { [K in keyof StaffCreateValues]: StaffCreateField } = {
  name: 'name',
  email: 'email',
  password: 'password',
  roleId: 'role_id',
  isActive: 'is_active',
  pin: 'pin',
};

export function emptyStaffValues(): StaffCreateValues {
  return { name: '', email: '', password: '', roleId: null, isActive: true, pin: '' };
}

export function validateStaffCreate(values: StaffCreateValues): {
  body: StaffCreateRequest | null;
  errors: FieldErrors<StaffCreateField>;
} {
  const errors: FieldErrors<StaffCreateField> = {};
  const name = values.name.trim();
  const email = values.email.trim();

  const nameError = checkName(name);
  if (nameError) errors.name = nameError;
  const emailError = checkEmail(email);
  if (emailError) errors.email = emailError;
  const passwordError = passwordProblem(values.password);
  if (passwordError) errors.password = passwordError;
  if (values.roleId === null) errors.role_id = 'Choose a role.';
  if (values.pin !== '' && !isPinFormatValid(values.pin)) errors.pin = PIN_FORMAT_MESSAGE;

  if (Object.keys(errors).length > 0 || values.roleId === null) return { body: null, errors };

  const body: StaffCreateRequest = {
    name,
    email,
    password: values.password,
    role_id: values.roleId,
    is_active: values.isActive,
  };
  // Optional: sent as a string (leading zeros survive) only when one was typed.
  if (values.pin !== '') body.pin = values.pin;
  return { body, errors };
}

/** New staff member: POST /api/v1/admin/users. */
export function useStaffCreateForm({ onSaved }: { onSaved: (user: StaffUser) => void }) {
  const mutations = useStaffMutations();

  return useRecordForm<StaffCreateValues, StaffCreateField, StaffUser, StaffCreateRequest, StaffUpdateRequest>({
    initial: undefined,
    toValues: emptyStaffValues,
    validate: validateStaffCreate,
    diff: () => ({}),
    fields: STAFF_CREATE_FIELDS,
    fieldOf: CREATE_FIELD_OF,
    create: mutations.create,
    onSaved,
  });
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/** Request fields of PATCH /api/v1/admin/users/{id}. Password and PIN have their own endpoints. */
export type StaffEditField = 'name' | 'email' | 'role_id' | 'is_active';

export const STAFF_EDIT_FIELDS: readonly StaffEditField[] = ['name', 'email', 'role_id', 'is_active'];

export type StaffEditValues = {
  name: string;
  email: string;
  roleId: number;
  isActive: boolean;
};

const EDIT_FIELD_OF: { [K in keyof StaffEditValues]: StaffEditField } = {
  name: 'name',
  email: 'email',
  roleId: 'role_id',
  isActive: 'is_active',
};

/** The full edit body; `diffStaff` then keeps only what changed. */
type StaffEditBody = Required<StaffUpdateRequest>;

export function staffToEditValues(user?: StaffUser): StaffEditValues {
  return {
    name: user?.name ?? '',
    email: user?.email ?? '',
    roleId: user?.role.id ?? 0,
    isActive: user?.is_active ?? true,
  };
}

export function validateStaffEdit(values: StaffEditValues): {
  body: StaffEditBody | null;
  errors: FieldErrors<StaffEditField>;
} {
  const errors: FieldErrors<StaffEditField> = {};
  const name = values.name.trim();
  const email = values.email.trim();
  const nameError = checkName(name);
  if (nameError) errors.name = nameError;
  const emailError = checkEmail(email);
  if (emailError) errors.email = emailError;
  if (Object.keys(errors).length > 0) return { body: null, errors };
  return { body: { name, email, role_id: values.roleId, is_active: values.isActive }, errors };
}

/**
 * Only the fields that changed (PATCH is partial). On your own record the
 * role and the active flag are never sent: the controls are disabled, and the
 * server would answer 409 anyway.
 */
export function diffStaff(saved: StaffUser, body: StaffEditBody, isSelf: boolean): StaffUpdateRequest {
  const changes: StaffUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if (body.email.toLowerCase() !== saved.email.toLowerCase()) changes.email = body.email;
  if (!isSelf && body.role_id !== saved.role.id) changes.role_id = body.role_id;
  if (!isSelf && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  return changes;
}

type UseStaffEditFormOptions = {
  staff: StaffUser;
  isSelf: boolean;
  onSaved: (user: StaffUser, changes: StaffUpdateRequest) => void;
  onDeleted: () => void;
};

/** Edit a staff member: PATCH /api/v1/admin/users/{id}, and DELETE (with a confirm). */
export function useStaffEditForm({ staff, isSelf, onSaved, onDeleted }: UseStaffEditFormOptions) {
  const mutations = useStaffMutations();

  const form = useRecordForm<StaffEditValues, StaffEditField, StaffUser, StaffEditBody, StaffUpdateRequest>({
    initial: staff,
    toValues: staffToEditValues,
    validate: validateStaffEdit,
    diff: (saved, body) => diffStaff(saved, body, isSelf),
    fields: STAFF_EDIT_FIELDS,
    fieldOf: EDIT_FIELD_OF,
    update: mutations.update,
    remove: mutations.remove,
    onSaved: (user, changes) => onSaved(user, changes as StaffUpdateRequest),
    onDeleted,
  });

  return { ...form, mutations };
}

export type StaffEditFormState = ReturnType<typeof useStaffEditForm>;
