/**
 * Add or edit a staff account (Staff & Customers → Staff endpoints,
 * `user.manage`; back-office.md → Forms).
 * - **Add:** name, email, password (policy, show/hide), role (only roles the
 *   caller may assign), active, and an optional PIN → `POST /admin/users`.
 * - **Edit:** name, email, role and active → `PATCH` (changed fields only).
 *   Your own role and active switch are locked (the server's self-protection
 *   409s still show in the banner). **Security:** reset the password
 *   (`POST …/password`), set, change or remove the PIN (`PUT …/pin`).
 * - Someone above your role (`can_manage: false`) is shown read-only.
 */
import { EyeIcon, EyeOffIcon, KeyRoundIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FieldError, FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/select';
import {
  isPinFormatValid,
  PASSWORD_POLICY_HINT,
  passwordProblem,
  PIN_FORMAT_MESSAGE,
  sanitizePin,
  STAFF_LIMITS,
  useCreateStaff,
  useResetStaffPassword,
  useRoles,
  useSetStaffPin,
  useStaffMember,
  useUpdateStaff,
} from '@/hooks/useStaff';
import { getErrorMessage } from '@/services/api';
import type { Role, StaffCreateRequest, StaffUpdateRequest, StaffUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { looksLikeEmail, splitSaveError, tooLong, type FieldErrors } from '@/utils/forms';
import { formatBranchDateTime } from '@pos/core/businessDay';

const SELF_ROLE_MESSAGE = 'You cannot change your own role.';
const SELF_DEACTIVATE_MESSAGE = 'You cannot deactivate your own account.';

export function StaffFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = useStaffMember(editing ? id : null);
  useShellHeader(editing ? 'Edit staff' : 'Add staff');

  if (!editing) return <StaffCreateForm />;
  if (existing.loading) return <LoadingRows rows={6} label="Loading the staff account…" />;
  if (existing.error || !existing.staff) {
    return (
      <PlainPage title="Edit staff">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <StaffEdit key={existing.staff.id} staff={existing.staff} />;
}

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        value={value}
        maxLength={STAFF_LIMITS.passwordMax}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="pr-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1 right-1"
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        onClick={() => setShown((current) => !current)}
      >
        {shown ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
      </Button>
    </div>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  current,
  disabled,
  loading,
}: {
  roles: Role[];
  value: string;
  onChange: (value: string) => void;
  /** The account's present role: always listed, even when the caller can't assign it. */
  current?: StaffUser['role'];
  disabled?: boolean;
  loading: boolean;
}) {
  const assignable = roles.filter((role) => role.assignable || role.id === current?.id);
  const listed = current && !assignable.some((role) => role.id === current.id);
  return (
    <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || loading}>
      {value === '' ? <option value="">{loading ? 'Loading roles…' : 'Choose a role'}</option> : null}
      {listed && current ? <option value={current.id}>{current.name}</option> : null}
      {assignable.map((role) => (
        <option key={role.id} value={role.id}>
          {role.name}
        </option>
      ))}
    </NativeSelect>
  );
}

function SaveFooter({ pending, cancelTo }: { pending: boolean; cancelTo: string }) {
  return (
    <div className="sticky bottom-0 mt-4 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
      <Button asChild variant="outline" size="lg">
        <Link to={cancelTo}>Cancel</Link>
      </Button>
      <Button type="submit" variant="green" size="lg" disabled={pending}>
        {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );
}

function checkIdentity(name: string, email: string, errors: FieldErrors) {
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > STAFF_LIMITS.name) errors.name = tooLong(STAFF_LIMITS.name);
  if (email === '') errors.email = 'Enter an email address.';
  else if (email.length > STAFF_LIMITS.email) errors.email = tooLong(STAFF_LIMITS.email);
  else if (!looksLikeEmail(email)) errors.email = 'Enter a valid email address.';
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CREATE_FIELDS = ['name', 'email', 'password', 'role_id', 'is_active', 'pin'] as const;

function StaffCreateForm() {
  const navigate = useNavigate();
  const roles = useRoles();
  const create = useCreateStaff();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [pin, setPin] = useState('');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const server = splitSaveError(create.error, CREATE_FIELDS);
  const fieldError = (field: (typeof CREATE_FIELDS)[number]) => clientErrors[field] ?? server.fieldErrors[field] ?? null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    const errors: FieldErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    checkIdentity(trimmedName, trimmedEmail, errors);
    const problem = passwordProblem(password);
    if (problem) errors.password = problem;
    if (roleId === '') errors.role_id = 'Choose a role.';
    if (pin !== '' && !isPinFormatValid(pin)) errors.pin = PIN_FORMAT_MESSAGE;
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const body: StaffCreateRequest = {
      name: trimmedName,
      email: trimmedEmail,
      password,
      role_id: Number(roleId),
      is_active: isActive,
      pin: pin === '' ? null : pin,
    };
    create.mutate(body, {
      onSuccess: (saved) => {
        toast.success(`${saved.name} added.`);
        void navigate('/staff');
      },
    });
  }

  const clear = () => setClientErrors({});

  return (
    <PlainPage title="Add staff" subtitle="A login for the POS, in this branch.">
      <form className="w-full max-w-[720px]" onSubmit={onSubmit} noValidate aria-busy={create.isPending}>
        <ErrorSummary />
        <Card className="flex flex-col gap-5 p-5">
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          {roles.error ? <Banner>{`Couldn't load the roles: ${roles.error}`}</Banner> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" error={fieldError('name')}>
              <Input
                value={name}
                maxLength={STAFF_LIMITS.name}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                  clear();
                }}
              />
            </FormField>
            <FormField label="Email" error={fieldError('email')} hint="Used to log in.">
              <Input
                type="email"
                value={email}
                maxLength={STAFF_LIMITS.email}
                autoComplete="off"
                onChange={(event) => {
                  setEmail(event.target.value);
                  clear();
                }}
              />
            </FormField>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="staff-password">Password</Label>
            <PasswordInput
              id="staff-password"
              value={password}
              onChange={(value) => {
                setPassword(value);
                clear();
              }}
              invalid={Boolean(fieldError('password'))}
              describedBy="staff-password-hint"
            />
            <p id="staff-password-hint" className="text-[13px] text-muted-foreground">
              {PASSWORD_POLICY_HINT}
            </p>
            <FieldError message={fieldError('password')} />
          </div>
          <FormField label="Role" error={fieldError('role_id')} hint="Only roles you may give are listed." className="sm:max-w-xs">
            <RoleSelect
              roles={roles.roles}
              value={roleId}
              loading={roles.loading}
              onChange={(value) => {
                setRoleId(value);
                clear();
              }}
            />
          </FormField>
          <FormField
            label="PIN (optional)"
            error={fieldError('pin')}
            hint="4 to 6 digits for the quick switch and manager approvals. Not 1111 or 1234."
            className="sm:max-w-xs"
          >
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => {
                setPin(sanitizePin(event.target.value));
                clear();
              }}
              className="tabular"
            />
          </FormField>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="staff-active">Active</Label>
              <p className="text-[13px] text-muted-foreground">A deactivated account can't log in.</p>
              <FieldError message={fieldError('is_active')} />
            </div>
            <Switch id="staff-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </Card>
        <SaveFooter pending={create.isPending} cancelTo="/staff" />
      </form>
    </PlainPage>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const EDIT_FIELDS = ['name', 'email', 'role_id', 'is_active'] as const;

function StaffEdit({ staff }: { staff: StaffUser }) {
  const user = useSessionStore((state) => state.user);
  const self = staff.id === user?.id;
  if (!staff.can_manage) return <StaffReadOnly staff={staff} />;
  return (
    <PlainPage title={`Edit ${staff.name}`} subtitle={self ? 'Your own account.' : staff.email}>
      <div className="flex w-full max-w-[720px] flex-col gap-4">
        <StaffDetailsForm staff={staff} self={self} />
        <StaffSecurity staff={staff} self={self} />
      </div>
    </PlainPage>
  );
}

function StaffReadOnly({ staff }: { staff: StaffUser }) {
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  return (
    <PlainPage title={staff.name} subtitle={staff.email}>
      <Card className="flex w-full max-w-[720px] flex-col gap-4 p-5">
        <Banner variant="info">This account is above your role, so you can view it but not change it.</Banner>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Role</dt>
            <dd className="font-medium">{staff.role.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{staff.is_active ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="danger" label="Deactivated" />}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">PIN</dt>
            <dd className="font-medium">{staff.has_pin ? 'Set' : 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last login</dt>
            <dd className="font-medium tabular">
              {staff.last_login_at ? (formatBranchDateTime(staff.last_login_at, timezone) ?? staff.last_login_at) : 'Never'}
            </dd>
          </div>
        </dl>
        <div>
          <Button asChild variant="outline">
            <Link to="/staff">Back to staff</Link>
          </Button>
        </div>
      </Card>
    </PlainPage>
  );
}

function StaffDetailsForm({ staff, self }: { staff: StaffUser; self: boolean }) {
  const navigate = useNavigate();
  const roles = useRoles();
  const update = useUpdateStaff();
  const [name, setName] = useState(staff.name);
  const [email, setEmail] = useState(staff.email);
  const [roleId, setRoleId] = useState(String(staff.role.id));
  const [isActive, setIsActive] = useState(staff.is_active);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const server = splitSaveError(update.error, EDIT_FIELDS);
  const fieldError = (field: (typeof EDIT_FIELDS)[number]) => clientErrors[field] ?? server.fieldErrors[field] ?? null;
  const clear = () => setClientErrors({});

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending) return;
    const errors: FieldErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    checkIdentity(trimmedName, trimmedEmail, errors);
    setClientErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const body: StaffUpdateRequest = {};
    if (trimmedName !== staff.name) body.name = trimmedName;
    if (trimmedEmail !== staff.email) body.email = trimmedEmail;
    if (!self && Number(roleId) !== staff.role.id) body.role_id = Number(roleId);
    if (!self && isActive !== staff.is_active) body.is_active = isActive;
    if (Object.keys(body).length === 0) {
      void navigate('/staff');
      return;
    }
    update.mutate(
      { id: staff.id, body },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved.`);
          void navigate('/staff');
        },
      },
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={update.isPending}>
      <ErrorSummary />
      <Card className="flex flex-col gap-5 p-5">
        <h2 className="text-base font-semibold">Account</h2>
        {server.banner ? <Banner>{server.banner}</Banner> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={fieldError('name')}>
            <Input
              value={name}
              maxLength={STAFF_LIMITS.name}
              onChange={(event) => {
                setName(event.target.value);
                clear();
              }}
            />
          </FormField>
          <FormField label="Email" error={fieldError('email')}>
            <Input
              type="email"
              value={email}
              maxLength={STAFF_LIMITS.email}
              onChange={(event) => {
                setEmail(event.target.value);
                clear();
              }}
            />
          </FormField>
        </div>
        <FormField
          label="Role"
          error={fieldError('role_id') ?? (roles.error ? `Couldn't load the roles: ${roles.error}` : null)}
          hint={self ? SELF_ROLE_MESSAGE : 'Only roles you may give are listed.'}
          className="sm:max-w-xs"
        >
          <RoleSelect
            roles={roles.roles}
            value={roleId}
            current={staff.role}
            disabled={self}
            loading={roles.loading}
            onChange={(value) => {
              setRoleId(value);
              clear();
            }}
          />
        </FormField>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <Label htmlFor="staff-edit-active">Active</Label>
            <p className="text-[13px] text-muted-foreground">
              {self ? SELF_DEACTIVATE_MESSAGE : 'Deactivating logs this person out everywhere.'}
            </p>
            <FieldError message={fieldError('is_active')} />
          </div>
          <Switch id="staff-edit-active" checked={isActive} disabled={self} onCheckedChange={setIsActive} />
        </div>
      </Card>
      <SaveFooter pending={update.isPending} cancelTo="/staff" />
    </form>
  );
}

function StaffSecurity({ staff, self }: { staff: StaffUser; self: boolean }) {
  const [dialog, setDialog] = useState<'password' | 'pin' | 'remove-pin' | null>(null);
  const setPin = useSetStaffPin();

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h2 className="text-base font-semibold">Security</h2>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Password</p>
          <p className="text-[13px] text-muted-foreground">
            {self ? 'Set a new password. This session stays signed in.' : 'Set a new password. This logs the person out everywhere.'}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => setDialog('password')}>
          <KeyRoundIcon aria-hidden="true" />
          Reset password
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">PIN</p>
          {staff.has_pin ? <Badge tone="neutral">Set</Badge> : <Badge tone="outline">Not set</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setDialog('pin')}>
            {staff.has_pin ? 'Change PIN' : 'Set PIN'}
          </Button>
          {staff.has_pin ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setPin.reset();
                setDialog('remove-pin');
              }}
            >
              Remove PIN
            </Button>
          ) : null}
        </div>
      </div>

      {dialog === 'password' ? <PasswordDialog staff={staff} self={self} onClose={() => setDialog(null)} /> : null}
      {dialog === 'pin' ? <PinDialog staff={staff} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === 'remove-pin'}
        onClose={() => setDialog(null)}
        title="Remove PIN"
        description={`${staff.name} can no longer use a PIN for the quick switch or approvals until a new one is set.`}
        confirmLabel="Remove PIN"
        pendingLabel="Removing…"
        pending={setPin.isPending}
        error={setPin.error ? getErrorMessage(setPin.error) : null}
        onConfirm={() =>
          setPin.mutate(
            { id: staff.id, pin: null },
            {
              onSuccess: () => {
                toast.success('PIN removed.');
                setDialog(null);
              },
            },
          )
        }
      />
    </Card>
  );
}

function PasswordDialog({ staff, self, onClose }: { staff: StaffUser; self: boolean; onClose: () => void }) {
  const reset = useResetStaffPassword();
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const server = splitSaveError(reset.error, ['password']);
  const error = problem ?? server.fieldErrors.password ?? null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (reset.isPending) return;
    const found = passwordProblem(password);
    setProblem(found);
    if (found) return;
    reset.mutate(
      { id: staff.id, password },
      {
        onSuccess: () => {
          toast.success(self ? 'Password changed.' : `Password reset. ${staff.name} is logged out everywhere.`);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (open || reset.isPending ? null : onClose())}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ErrorSummary />
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>A new password for {staff.name}.</DialogDescription>
          </DialogHeader>
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <PasswordInput
              id="reset-password"
              value={password}
              onChange={(value) => {
                setPassword(value);
                setProblem(null);
              }}
              invalid={Boolean(error)}
              describedBy="reset-password-hint"
            />
            <p id="reset-password-hint" className="text-[13px] text-muted-foreground">
              {PASSWORD_POLICY_HINT}
            </p>
            <FieldError message={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={reset.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="green" disabled={reset.isPending}>
              {reset.isPending ? 'Saving…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PinDialog({ staff, onClose }: { staff: StaffUser; onClose: () => void }) {
  const setPin = useSetStaffPin();
  const [pin, setPinText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const server = splitSaveError(setPin.error, ['pin']);
  const error = problem ?? server.fieldErrors.pin ?? null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (setPin.isPending) return;
    const found = isPinFormatValid(pin) ? null : PIN_FORMAT_MESSAGE;
    setProblem(found);
    if (found) return;
    setPin.mutate(
      { id: staff.id, pin },
      {
        onSuccess: () => {
          toast.success(staff.has_pin ? 'PIN changed.' : 'PIN set.');
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => (open || setPin.isPending ? null : onClose())}>
      <DialogContent className="max-w-sm">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <ErrorSummary />
          <DialogHeader>
            <DialogTitle>{staff.has_pin ? 'Change PIN' : 'Set PIN'}</DialogTitle>
            <DialogDescription>4 to 6 digits for {staff.name}. Not all one digit (1111) or a straight run (1234).</DialogDescription>
          </DialogHeader>
          {server.banner ? <Banner>{server.banner}</Banner> : null}
          <FormField label="New PIN" error={error}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => {
                setPinText(sanitizePin(event.target.value));
                setProblem(null);
              }}
              className="tabular"
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={setPin.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="green" disabled={setPin.isPending}>
              {setPin.isPending ? 'Saving…' : 'Save PIN'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
