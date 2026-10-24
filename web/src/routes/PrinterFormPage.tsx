/**
 * Add or edit a printer (Printing → Admin printers; back-office.md → Forms:
 * no band, a white card up to 720 px, a label above every field, Cancel and
 * Save in a sticky footer). 422 messages sit under their fields; a 409 (the
 * 20-printer limit) shows in the banner.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Segmented } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox, Switch } from '@/components/ui/misc';
import { usePrintConfig } from '@/hooks/usePrintConfig';
import { usePrinter, useRoutableCategories, useSavePrinter } from '@/hooks/usePrinters';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import type { PaperWidthMm, Printer, PrinterCreateRequest, PrinterRole } from '@/services/types';

const ROLE_OPTIONS: { value: PrinterRole; label: string }[] = [
  { value: 'cashier', label: 'Receipt printer' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
];

const WIDTH_OPTIONS: { value: '80' | '58'; label: string }[] = [
  { value: '80', label: '80 mm (48 columns)' },
  { value: '58', label: '58 mm (32 columns)' },
];

/** Contract rule: an IPv4 address or a hostname (letters, digits, hyphens and dots; no scheme, no port). */
const HOST_PATTERN = /^[A-Za-z0-9.-]+$/;

type Draft = {
  name: string;
  role: PrinterRole;
  host: string;
  port: string;
  paperWidth: '80' | '58';
  isEnabled: boolean;
  isDefaultKitchen: boolean;
  categoryIds: number[];
};

function draftFrom(printer: Printer | null): Draft {
  return {
    name: printer?.name ?? '',
    role: printer?.role ?? 'kitchen',
    host: printer?.host ?? '',
    port: String(printer?.port ?? 9100),
    paperWidth: printer?.paper_width_mm === 58 ? '58' : '80',
    isEnabled: printer?.is_enabled ?? true,
    isDefaultKitchen: printer?.is_default_kitchen ?? false,
    categoryIds: printer?.category_ids ?? [],
  };
}

type ClientErrors = Partial<Record<'name' | 'host' | 'port', string>>;

function check(draft: Draft): { body: PrinterCreateRequest | null; errors: ClientErrors } {
  const errors: ClientErrors = {};
  const name = draft.name.trim();
  const host = draft.host.trim();
  const port = Number(draft.port.trim());
  if (name === '') errors.name = 'Enter a name, e.g. Kitchen.';
  else if (name.length > 40) errors.name = 'Use 40 characters or fewer.';
  if (host === '') errors.host = 'Enter the IP address, e.g. 192.168.1.60.';
  else if (host.length > 253 || !HOST_PATTERN.test(host)) errors.host = 'Enter an IP address or host name only (no http:// and no port).';
  if (!/^\d{1,5}$/.test(draft.port.trim()) || port < 1 || port > 65535) errors.port = 'Enter a port from 1 to 65535 (usually 9100).';
  if (Object.keys(errors).length > 0) return { body: null, errors };
  const cashier = draft.role === 'cashier';
  return {
    body: {
      name,
      role: draft.role,
      host,
      port,
      paper_width_mm: Number(draft.paperWidth) as PaperWidthMm,
      is_enabled: draft.isEnabled,
      is_default_kitchen: cashier ? false : draft.isDefaultKitchen,
      category_ids: cashier ? [] : [...draft.categoryIds].sort((a, b) => a - b),
    },
    errors,
  };
}

export function PrinterFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = usePrinter(editing ? id : null);
  useShellHeader(editing ? 'Edit printer' : 'Add printer');

  if (editing && existing.loading) return <LoadingRows rows={6} label="Loading the printer…" />;
  if (editing && existing.error) {
    return (
      <PlainPage title="Edit printer">
        <Card>
          <ErrorState message={existing.error} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <PrinterForm key={existing.printer?.id ?? 'new'} printer={editing ? existing.printer : null} />;
}

function PrinterForm({ printer }: { printer: Printer | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(printer));
  const [clientErrors, setClientErrors] = useState<ClientErrors>({});
  const save = useSavePrinter(printer?.id ?? null);
  const categories = useRoutableCategories();
  const { config } = usePrintConfig();

  const server = isApiValidationError(save.error) ? save.error : null;
  const bannerError = save.error && !server ? getErrorMessage(save.error) : null;
  const fieldError = (field: keyof ClientErrors | 'role' | 'paper_width_mm' | 'is_enabled' | 'is_default_kitchen' | 'category_ids') =>
    (field in clientErrors ? clientErrors[field as keyof ClientErrors] : undefined) ?? server?.firstError(field) ?? null;
  const categoryError = server
    ? (server.firstError('category_ids') ??
      Object.entries(server.errors).find(([key]) => key.startsWith('category_ids.'))?.[1]?.[0] ??
      null)
    : null;

  // "at Bar": a category already routed to another printer (saving here moves it).
  const routedElsewhere = new Map<number, string>();
  for (const other of config?.printers ?? []) {
    if (other.id === printer?.id) continue;
    for (const categoryId of other.category_ids) routedElsewhere.set(categoryId, other.name);
  }
  const listedIds = new Set(categories.categories.map((category) => category.id));
  const hiddenRouted = draft.categoryIds.filter((categoryId) => !listedIds.has(categoryId));

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
    setClientErrors({});
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const checked = check(draft);
    setClientErrors(checked.errors);
    if (!checked.body) return;
    save.mutate(checked.body, { onSuccess: () => void navigate('/printers') });
  }

  const ticketPrinter = draft.role !== 'cashier';

  return (
    <PlainPage title={printer ? `Edit ${printer.name}` : 'Add printer'} subtitle="A network thermal printer (raw ESC/POS, usually port 9100).">
      <form className="w-full max-w-[720px]" onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
        <ErrorSummary />
        <Card className="flex flex-col gap-5 p-5">
          {bannerError ? <Banner>{bannerError}</Banner> : null}
          {server && !bannerError ? <Banner>{server.message}</Banner> : null}

          <FormField label="Name" error={fieldError('name')}>
            <Input value={draft.name} maxLength={40} onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Kitchen" />
          </FormField>

          <div className="flex flex-col gap-1">
            <Segmented label="Role" value={draft.role} options={ROLE_OPTIONS} onChange={(role) => change({ role })} />
            <FieldError message={fieldError('role')} />
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <FormField label="IP address or host name" error={fieldError('host')}>
              <Input value={draft.host} maxLength={253} onChange={(event) => change({ host: event.target.value })} placeholder="192.168.1.60" />
            </FormField>
            <FormField label="Port" error={fieldError('port')}>
              <Input inputMode="numeric" value={draft.port} onChange={(event) => change({ port: event.target.value })} className="tabular" />
            </FormField>
          </div>

          <div className="flex flex-col gap-1">
            <Segmented label="Paper width" value={draft.paperWidth} options={WIDTH_OPTIONS} onChange={(paperWidth) => change({ paperWidth })} />
            <FieldError message={fieldError('paper_width_mm')} />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="printer-enabled">Enabled</Label>
              <p className="text-[13px] text-muted-foreground">A disabled printer receives no jobs.</p>
            </div>
            <Switch id="printer-enabled" checked={draft.isEnabled} onCheckedChange={(isEnabled) => change({ isEnabled })} />
          </div>

          {ticketPrinter ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="printer-default">Default kitchen printer</Label>
                  <p className="text-[13px] text-muted-foreground">Receives items from categories that have no printer.</p>
                  <FieldError message={fieldError('is_default_kitchen')} />
                </div>
                <Switch id="printer-default" checked={draft.isDefaultKitchen} onCheckedChange={(isDefaultKitchen) => change({ isDefaultKitchen })} />
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Categories printed here</legend>
                {categories.loading ? (
                  <LoadingRows rows={3} label="Loading categories…" />
                ) : categories.error ? (
                  <ErrorState message={categories.error} onRetry={categories.reload} />
                ) : categories.categories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No categories yet.</p>
                ) : (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {categories.categories.map((category) => {
                      const checkboxId = `printer-category-${category.id}`;
                      const elsewhere = routedElsewhere.get(category.id);
                      return (
                        <li key={category.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-row-hover">
                          <Checkbox
                            id={checkboxId}
                            checked={draft.categoryIds.includes(category.id)}
                            onCheckedChange={(checked) =>
                              change({
                                categoryIds: checked
                                  ? [...draft.categoryIds, category.id]
                                  : draft.categoryIds.filter((value) => value !== category.id),
                              })
                            }
                          />
                          <Label htmlFor={checkboxId} className="font-normal">
                            {category.name}
                            {!category.is_active ? <span className="text-muted-foreground"> (inactive)</span> : null}
                            {elsewhere ? <span className="text-[13px] text-warning"> · at {elsewhere}</span> : null}
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {hiddenRouted.length > 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Also routed here: {hiddenRouted.length} {hiddenRouted.length === 1 ? 'category' : 'categories'} you can't see in this list (kept as they are).
                  </p>
                ) : null}
                <FieldError message={categoryError} />
              </fieldset>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Receipt printers print receipts only; they take no categories.</p>
          )}
        </Card>

        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          <Button asChild variant="outline" size="lg">
            <Link to="/printers">Cancel</Link>
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
