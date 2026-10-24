/**
 * Admin Devices dialogs (Hardening & Pilot §C/§E): rename, retire (with the
 * 409 "still has n unsynced sales" confirm) and restore.
 */
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DEVICE_NAME_MAX, useRenameDevice, useRestoreDevice, useRetireDevice } from '@/hooks/useAdminDevices';
import { getErrorMessage, isApiError, isApiValidationError } from '@/services/api';
import type { AdminDevice } from '@/services/types';

type DialogProps = { device: AdminDevice | null; onClose: () => void; onDone?: (device: AdminDevice) => void };

function RenameForm({ device, onClose, onDone }: { device: AdminDevice; onClose: () => void; onDone?: (device: AdminDevice) => void }) {
  const rename = useRenameDevice();
  const [name, setName] = useState(device.name);
  const [localError, setLocalError] = useState<string | null>(null);
  const validation = isApiValidationError(rename.error) ? rename.error : null;
  const bannerError = rename.error && !validation ? getErrorMessage(rename.error) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setLocalError('Enter a name.');
      return;
    }
    setLocalError(null);
    rename.mutate(
      { id: device.id, name: trimmed },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.code} renamed.`);
          onDone?.(saved);
          onClose();
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ErrorSummary />
      {bannerError ? <Banner>{bannerError}</Banner> : null}
      <FormField label="Name" error={localError ?? validation?.firstError('name') ?? (validation ? validation.message : null)} hint={`Up to ${DEVICE_NAME_MAX} characters.`}>
        <Input value={name} maxLength={DEVICE_NAME_MAX} onChange={(event) => setName(event.target.value)} autoFocus autoComplete="off" />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={rename.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="green" disabled={rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Save name'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RenameDeviceDialog({ device, onClose, onDone }: DialogProps) {
  return (
    <Dialog open={device !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {device?.code ?? 'device'}</DialogTitle>
          <DialogDescription>The name staff and managers see for this device. Its code never changes.</DialogDescription>
        </DialogHeader>
        {device ? <RenameForm key={device.id} device={device} onClose={onClose} onDone={onDone} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Retire: first a plain confirmation; when the server answers 409 (the last
 * heartbeat reported unsynced sales), its message is shown and **Retire anyway**
 * sends `confirm: true`.
 */
export function RetireDeviceDialog({ device, onClose, onDone }: DialogProps) {
  const retire = useRetireDevice();
  const [unsynced, setUnsynced] = useState<string | null>(null);
  const conflict = isApiError(retire.error) && retire.error.status === 409;
  const error = retire.error && !conflict ? getErrorMessage(retire.error) : null;

  function close() {
    setUnsynced(null);
    retire.reset();
    onClose();
  }

  function run(confirm: boolean) {
    if (!device) return;
    retire.mutate(
      { id: device.id, confirm },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.code} retired.`);
          onDone?.(saved);
          close();
        },
        onError: (failure) => {
          if (isApiError(failure) && failure.status === 409) setUnsynced(failure.message);
        },
      },
    );
  }

  const description = unsynced ? (
    <span className="font-medium text-warning">{unsynced}</span>
  ) : device ? (
    `${device.code} (${device.name}) is signed out and staff can't sign in on it until it is restored.`
  ) : (
    ''
  );

  return (
    <ConfirmDialog
      open={device !== null}
      onClose={close}
      title={unsynced ? 'Unsynced sales on this device' : `Retire ${device?.code ?? 'device'}`}
      description={description}
      confirmLabel={unsynced ? 'Retire anyway' : 'Retire device'}
      pendingLabel="Retiring…"
      pending={retire.isPending}
      error={error}
      onConfirm={() => run(unsynced !== null)}
    />
  );
}

export function RestoreDeviceDialog({ device, onClose, onDone }: DialogProps) {
  const restore = useRestoreDevice();
  function close() {
    restore.reset();
    onClose();
  }
  return (
    <ConfirmDialog
      open={device !== null}
      onClose={close}
      title={`Restore ${device?.code ?? 'device'}`}
      description={device ? `${device.name} becomes active again. Staff sign in on it as usual.` : ''}
      confirmLabel="Restore device"
      pendingLabel="Restoring…"
      pending={restore.isPending}
      error={restore.error ? getErrorMessage(restore.error) : null}
      destructive={false}
      onConfirm={() => {
        if (device)
          restore.mutate(device.id, {
            onSuccess: (saved) => {
              toast.success(`${saved.code} restored.`);
              onDone?.(saved);
              close();
            },
          });
      }}
    />
  );
}
