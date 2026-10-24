/**
 * A destructive confirmation (back-office.md: destructive actions sit in the
 * row ⋯ menu and confirm in a dialog). The server's refusal (403, 409…) shows
 * in the dialog, and the confirm button is disabled while the request runs.
 */
import type { ReactNode } from 'react';

import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  /** `false`: a plain (non-destructive) confirmation, e.g. reactivate. */
  destructive?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  destructive = true,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next || pending ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <Banner>{error}</Banner> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? 'destructiveSolid' : 'green'} disabled={pending} onClick={onConfirm}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
