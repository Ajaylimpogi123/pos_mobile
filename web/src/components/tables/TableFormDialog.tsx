/**
 * Add or edit a dining table (Dine-in Tables & Tabs §B): name (max 10,
 * letters, numbers, spaces and dashes, so it fits an order's table number),
 * area (optional, max 30), seats (1–50), sort order (0–9999) and active.
 * Client checks first; the server's 422 messages show under their fields,
 * anything else (e.g. the 409 for deactivating a table with an open bill) in
 * the banner. Submit is disabled while the request runs.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FormField } from '@/components/common/FormField';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { useSaveTable } from '@/hooks/useDiningTables';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { DiningTable, DiningTableCreateRequest } from '@/services/types';
import { parseTableNo, TABLE_NO_MAX } from '@pos/core/sale/table';

type Field = 'name' | 'area' | 'seats' | 'sort_order' | 'is_active';

type Draft = { name: string; area: string; seats: string; sort_order: string; is_active: boolean };

const LIMITS = { nameMax: TABLE_NO_MAX, areaMax: 30, seatsMin: 1, seatsMax: 50, sortMax: 9999 } as const;

function draftOf(table: DiningTable | null): Draft {
  return {
    name: table?.name ?? '',
    area: table?.area ?? '',
    seats: table ? String(table.seats) : '4',
    sort_order: table ? String(table.sort_order) : '0',
    is_active: table?.is_active ?? true,
  };
}

function wholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

function validate(draft: Draft): { body: DiningTableCreateRequest | null; errors: Partial<Record<Field, string>> } {
  const errors: Partial<Record<Field, string>> = {};
  // The name is an order's table number when a bill is paid: the same rule (Table Number).
  const parsedName = parseTableNo(draft.name);
  const name = parsedName.value ?? '';
  if (draft.name.trim() === '') errors.name = 'Enter the table name.';
  else if (parsedName.error) errors.name = parsedName.error;
  const area = draft.area.trim();
  if (area.length > LIMITS.areaMax) errors.area = `Use ${LIMITS.areaMax} characters or fewer.`;
  const seats = wholeNumber(draft.seats, LIMITS.seatsMin, LIMITS.seatsMax);
  if (seats === null) errors.seats = `Enter ${LIMITS.seatsMin} to ${LIMITS.seatsMax} seats.`;
  const sortOrder = wholeNumber(draft.sort_order, 0, LIMITS.sortMax);
  if (sortOrder === null) errors.sort_order = `Enter a number from 0 to ${LIMITS.sortMax}.`;
  if (Object.keys(errors).length > 0 || seats === null || sortOrder === null) return { body: null, errors };
  return { body: { name, area: area === '' ? null : area, seats, sort_order: sortOrder, is_active: draft.is_active }, errors };
}

type TableFormDialogProps = {
  /** `undefined`: closed; `null`: a new table. */
  table: DiningTable | null | undefined;
  /** The area a new table starts in (e.g. "Add to Patio"). */
  defaultArea?: string | null;
  onClose: () => void;
};

export function TableFormDialog({ table, defaultArea, onClose }: TableFormDialogProps) {
  const open = table !== undefined;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg">
        {open ? <TableForm key={table?.id ?? 'new'} table={table} defaultArea={defaultArea ?? null} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TableForm({ table, defaultArea, onClose }: { table: DiningTable | null; defaultArea: string | null; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => ({ ...draftOf(table), area: table ? (table.area ?? '') : (defaultArea ?? '') }));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const save = useSaveTable(table?.id ?? null);
  const server = isApiValidationError(save.error) ? save.error : null;
  const banner = save.error && !server ? getErrorMessage(save.error) : null;

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
    setErrors({});
    if (save.error) save.reset();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const result = validate(draft);
    setErrors(result.errors);
    if (!result.body) return;
    save.mutate(result.body, {
      onSuccess: (saved) => {
        toast.success(table ? `Table ${saved.name} saved.` : `Table ${saved.name} added.`);
        onClose();
      },
    });
  }

  const fieldError = (field: Field) => errors[field] ?? server?.firstError(field) ?? null;
  const unmatched = server && !(['name', 'area', 'seats', 'sort_order', 'is_active'] as const).some((field) => server.firstError(field)) ? server.message : null;

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
      <ErrorSummary />
      <DialogHeader>
        <DialogTitle>{table ? `Edit table ${table.name}` : 'Add table'}</DialogTitle>
        <DialogDescription>Tables show on the POS Tables view, grouped by area.</DialogDescription>
      </DialogHeader>
      {banner ? <Banner>{banner}</Banner> : null}
      {unmatched ? <Banner>{unmatched}</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" error={fieldError('name')} hint="Printed as the table number, e.g. 5 or Patio 2.">
          <Input autoFocus value={draft.name} maxLength={LIMITS.nameMax} autoComplete="off" onChange={(event) => change({ name: event.target.value })} />
        </FormField>
        <FormField label="Area (optional)" error={fieldError('area')} hint="e.g. Patio, Upstairs.">
          <Input value={draft.area} maxLength={LIMITS.areaMax} autoComplete="off" onChange={(event) => change({ area: event.target.value })} />
        </FormField>
        <FormField label="Seats" error={fieldError('seats')}>
          <Input inputMode="numeric" value={draft.seats} maxLength={2} onChange={(event) => change({ seats: event.target.value })} />
        </FormField>
        <FormField label="Sort order" error={fieldError('sort_order')} hint="Lower numbers come first in their area.">
          <Input inputMode="numeric" value={draft.sort_order} maxLength={4} onChange={(event) => change({ sort_order: event.target.value })} />
        </FormField>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div>
          <Label htmlFor="table-active">Active</Label>
          <p className="text-[13px] text-muted-foreground">Inactive tables don't show on the POS.</p>
          {fieldError('is_active') ? <p className="text-[13px] font-medium text-danger">{fieldError('is_active')}</p> : null}
        </div>
        <Switch id="table-active" checked={draft.is_active} onCheckedChange={(value) => change({ is_active: value })} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="green" disabled={save.isPending}>
          {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {save.isPending ? 'Saving…' : table ? 'Save' : 'Add table'}
        </Button>
      </DialogFooter>
    </form>
  );
}
