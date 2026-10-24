/**
 * Open a bill on a free table (Dine-in Tables & Tabs §D.1): the guests (1–99,
 * starting at the table's seats) and an optional note. `POST /tabs` with a
 * ULID made for this action (also the `Idempotency-Key`), reused on every
 * retry until a `201`. A `409` ("Table 5 already has an open bill.") shows
 * here and refreshes the Tables view.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { QtyStepper } from '@/components/sell/SellParts';
import { invalidateTables } from '@/hooks/useDiningTables';
import { useTabAction, useTabCache } from '@/hooks/useTab';
import { openTab } from '@/services/tabs';
import type { Tab, TableView } from '@/services/types';
import { TAB_LIMITS } from '@/utils/tables';

type OpenTabDialogProps = {
  table: TableView | null;
  onClose: () => void;
  onOpened: (tab: Tab) => void;
};

export function OpenTabDialog({ table, onClose, onOpened }: OpenTabDialogProps) {
  return (
    <Dialog open={table !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-w-md">{table ? <OpenTabForm key={table.id} table={table} onClose={onClose} onOpened={onOpened} /> : null}</DialogContent>
    </Dialog>
  );
}

function OpenTabForm({ table, onClose, onOpened }: { table: TableView; onClose: () => void; onOpened: (tab: Tab) => void }) {
  const queryClient = useQueryClient();
  const saveTab = useTabCache();
  const [guests, setGuests] = useState(Math.min(TAB_LIMITS.guestsMax, Math.max(TAB_LIMITS.guestsMin, table.seats)));
  const [notes, setNotes] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const action = useTabAction({
    run: (key, body: { guests: number; notes: string | null }) => openTab({ ulid: key, table_id: table.id, guests: body.guests, notes: body.notes }),
    onConflict: (message) => {
      setConflict(message);
      invalidateTables(queryClient);
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.busy) return;
    setConflict(null);
    const tab = await action.send({ guests, notes: notes.trim() === '' ? null : notes.trim() });
    if (tab) {
      saveTab(tab);
      onOpened(tab);
    }
  }

  const otherField = Object.entries(action.fieldErrors).find(([field]) => field !== 'guests' && field !== 'notes')?.[1] ?? null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate aria-busy={action.busy}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>Open table {table.name}</DialogTitle>
        <DialogDescription>
          {table.area ? `${table.area} · ` : ''}
          {table.seats} {table.seats === 1 ? 'seat' : 'seats'}
        </DialogDescription>
      </DialogHeader>
      {conflict ? <Banner>{conflict}</Banner> : null}
      {action.banner ? <Banner variant="warning">{action.banner}</Banner> : null}
      {otherField ? <Banner>{otherField}</Banner> : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Guests</span>
        <QtyStepper value={guests} onChange={setGuests} min={TAB_LIMITS.guestsMin} max={TAB_LIMITS.guestsMax} label="guests" disabled={action.busy} />
        {action.fieldErrors.guests ? <p className="text-[13px] font-medium text-danger">{action.fieldErrors.guests}</p> : null}
      </div>
      <FormField label="Note (optional)" error={action.fieldErrors.notes}>
        <Input value={notes} maxLength={TAB_LIMITS.notesMax} autoComplete="off" onChange={(event) => setNotes(event.target.value)} disabled={action.busy} />
      </FormField>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={action.busy}>
          Cancel
        </Button>
        <Button type="submit" variant="green" size="lg" disabled={action.busy}>
          {action.busy ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {action.busy ? 'Opening…' : 'Open bill'}
        </Button>
      </DialogFooter>
    </form>
  );
}
