/**
 * A decline with its reason (§F item decline, §G PO decline): the reason is
 * required (max 255); its message (a client check or the server's 422) sits
 * under the field, any other refusal (403 self-approval, 409) in a banner.
 */
import type { FormEvent } from 'react';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';

type ReasonDialogProps = {
  open: boolean;
  title: string;
  description: string;
  reason: string;
  error: string | null;
  banner: string | null;
  busy: boolean;
  confirmLabel: string;
  onReason: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

export function ReasonDialog({ open, title, description, reason, error, banner, busy, confirmLabel, onReason, onSubmit, onClose }: ReasonDialogProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent hideClose={busy} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate aria-busy={busy}>
          <ErrorSummary />
          {banner ? <Banner>{banner}</Banner> : null}
          <FormField label="Reason" error={error}>
            <Textarea autoFocus value={reason} maxLength={255} onChange={(event) => onReason(event.target.value)} disabled={busy} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructiveSolid" disabled={busy}>
              {busy ? 'Declining…' : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
