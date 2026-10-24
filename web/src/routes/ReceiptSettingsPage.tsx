/**
 * Receipt settings (Printing → Admin receipt settings; `settings.manage`):
 * header and footer lines (up to 6 of up to 48 characters), auto-print,
 * copies (1–3) and kitchen tickets, with **Print sample** on this terminal's
 * receipt printer. 422 messages sit under their lines.
 * Dine-in Tables & Tabs §I: the **Dine-in** card (on/off and the service
 * charge %); turning it off with open bills is a `409`, shown in the banner.
 */
import { ArrowDownIcon, ArrowUpIcon, ArmchairIcon, LoaderCircleIcon, PlusIcon, PrinterIcon, XIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { PrintersNav } from '@/components/printers/PrintersNav';
import { PrintJobList } from '@/components/printing/PrintJobList';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Segmented } from '@/components/sell/SellParts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { useTestPrinting } from '@/hooks/useOrderPrinting';
import { useBranchSettings, useSaveBranchSettings } from '@/hooks/usePrinters';
import { getErrorMessage, isApiValidationError, type ApiValidationError } from '@/services/api';
import type { BranchSettings } from '@/services/types';
import { formatPercentValue, parseDiscountInput } from '@pos/core/sale/discountRules';

const MAX_LINES = 6;
const MAX_LINE_LENGTH = 48;
/** §A: service_charge_bps max 2000 (20%). */
const SERVICE_CHARGE_MAX_BPS = 2000;

type LinesKey = 'receipt_header_lines' | 'receipt_footer_lines';

type Draft = {
  receipt_header_lines: string[];
  receipt_footer_lines: string[];
  auto_print_receipt: boolean;
  receipt_copies: '1' | '2' | '3';
  print_kitchen_tickets: boolean;
  /** Dine-in Tables & Tabs §A. */
  dine_in_enabled: boolean;
  /** The service charge as typed, in percent (empty or 0: none). */
  service_charge: string;
};

function draftFrom(settings: BranchSettings): Draft {
  return {
    receipt_header_lines: [...settings.receipt_header_lines],
    receipt_footer_lines: [...settings.receipt_footer_lines],
    auto_print_receipt: settings.auto_print_receipt,
    receipt_copies: String(Math.min(3, Math.max(1, settings.receipt_copies))) as Draft['receipt_copies'],
    print_kitchen_tickets: settings.print_kitchen_tickets,
    dine_in_enabled: settings.dine_in_enabled,
    service_charge: settings.service_charge_bps > 0 ? formatPercentValue(settings.service_charge_bps).replace('%', '') : '0',
  };
}

/** §A: the service charge is 0–20% (0–2000 basis points), up to 2 decimals; never through a float. */
function parseServiceCharge(text: string): { bps: number; error: null } | { bps: null; error: string } {
  const trimmed = text.trim().replace(/%$/, '').trim();
  if (trimmed === '' || /^0+(\.0{0,2})?$/.test(trimmed)) return { bps: 0, error: null };
  const parsed = parseDiscountInput('percent', trimmed);
  if (parsed.value === null) return { bps: null, error: 'Enter a percentage from 0 to 20, like 10 or 12.5.' };
  if (parsed.value > SERVICE_CHARGE_MAX_BPS) return { bps: null, error: 'The service charge can be at most 20%.' };
  return { bps: parsed.value, error: null };
}

export function ReceiptSettingsPage() {
  useShellHeader('Printers & settings');
  const current = useBranchSettings();

  return (
    <PlainPage title="Receipt settings" subtitle="What every receipt of this branch prints, and when.">
      <PrintersNav />
      {current.loading ? (
        <LoadingRows rows={6} label="Loading the settings…" />
      ) : current.error ? (
        <Card>
          <ErrorState message={current.error} onRetry={current.reload} />
        </Card>
      ) : current.settings ? (
        <SettingsForm key={current.settings.updated_at ?? 'defaults'} settings={current.settings} />
      ) : null}
    </PlainPage>
  );
}

function LinesEditor({
  label,
  hint,
  lines,
  onChange,
  server,
  field,
}: {
  label: string;
  hint: string;
  lines: string[];
  onChange: (lines: string[]) => void;
  server: ApiValidationError | null;
  field: LinesKey;
}) {
  function move(index: number, by: number) {
    const next = [...lines];
    const [line] = next.splice(index, 1);
    next.splice(index + by, 0, line);
    onChange(next);
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <p className="text-[13px] text-muted-foreground">{hint}</p>
      {lines.map((line, index) => {
        const id = `${field}-${index}`;
        const error = server?.firstError(`${field}.${index}`) ?? (line.trim() === '' ? 'Enter the text, or remove the line.' : null);
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Label htmlFor={id} className="sr-only">
                {label} line {index + 1}
              </Label>
              <Input
                id={id}
                value={line}
                maxLength={MAX_LINE_LENGTH}
                onChange={(event) => onChange(lines.map((value, at) => (at === index ? event.target.value : value)))}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
              />
              <Button variant="ghost" size="icon" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move line ${index + 1} up`}>
                <ArrowUpIcon aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => move(index, 1)}
                disabled={index === lines.length - 1}
                aria-label={`Move line ${index + 1} down`}
              >
                <ArrowDownIcon aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onChange(lines.filter((_, at) => at !== index))}
                aria-label={`Remove line ${index + 1}`}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </div>
            <FieldError id={`${id}-error`} message={error} />
          </div>
        );
      })}
      <FieldError message={server?.firstError(field)} />
      {lines.length < MAX_LINES ? (
        <Button variant="outline" className="w-fit" onClick={() => onChange([...lines, ''])}>
          <PlusIcon aria-hidden="true" />
          Add line
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">Up to {MAX_LINES} lines.</p>
      )}
    </fieldset>
  );
}

function SettingsForm({ settings }: { settings: BranchSettings }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(settings));
  const save = useSaveBranchSettings();
  const testing = useTestPrinting();
  const server = isApiValidationError(save.error) ? save.error : null;
  const bannerError = save.error && !server ? getErrorMessage(save.error) : null;
  const hasBlankLine = [...draft.receipt_header_lines, ...draft.receipt_footer_lines].some((line) => line.trim() === '');
  const serviceCharge = parseServiceCharge(draft.service_charge);

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (hasBlankLine || serviceCharge.bps === null) return;
    save.mutate(
      {
        receipt_header_lines: draft.receipt_header_lines.map((line) => line.trim()),
        receipt_footer_lines: draft.receipt_footer_lines.map((line) => line.trim()),
        auto_print_receipt: draft.auto_print_receipt,
        receipt_copies: Number(draft.receipt_copies),
        print_kitchen_tickets: draft.print_kitchen_tickets,
        dine_in_enabled: draft.dine_in_enabled,
        service_charge_bps: serviceCharge.bps,
      },
      { onSuccess: () => toast.success('Receipt settings saved.') },
    );
  }

  return (
    <form className="w-full max-w-[720px]" onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
      <ErrorSummary />
      <Card className="flex flex-col gap-6 p-5">
        {bannerError ? <Banner>{bannerError}</Banner> : null}
        {server ? <Banner>{server.message}</Banner> : null}

        <LinesEditor
          label="Header lines"
          hint="Centred at the top; the first line prints bold. Up to 6 lines of 48 characters."
          lines={draft.receipt_header_lines}
          onChange={(lines) => change({ receipt_header_lines: lines })}
          server={server}
          field="receipt_header_lines"
        />
        <LinesEditor
          label="Footer lines"
          hint="Centred at the bottom, e.g. This is not an official receipt."
          lines={draft.receipt_footer_lines}
          onChange={(lines) => change({ receipt_footer_lines: lines })}
          server={server}
          field="receipt_footer_lines"
        />

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <Label htmlFor="settings-auto-print">Print the receipt automatically</Label>
            <p className="text-[13px] text-muted-foreground">Off: the sale screen shows a Print receipt button.</p>
            <FieldError message={server?.firstError('auto_print_receipt')} />
          </div>
          <Switch id="settings-auto-print" checked={draft.auto_print_receipt} onCheckedChange={(value) => change({ auto_print_receipt: value })} />
        </div>

        <div className="flex flex-col gap-1">
          <Segmented
            label="Receipt copies"
            value={draft.receipt_copies}
            options={[
              { value: '1', label: '1 copy' },
              { value: '2', label: '2 copies' },
              { value: '3', label: '3 copies' },
            ]}
            onChange={(value) => change({ receipt_copies: value })}
          />
          <FieldError message={server?.firstError('receipt_copies')} />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <Label htmlFor="settings-kitchen">Print kitchen and bar tickets</Label>
            <p className="text-[13px] text-muted-foreground">Off: no tickets print after a sale. Reprint from Order History still prints them.</p>
            <FieldError message={server?.firstError('print_kitchen_tickets')} />
          </div>
          <Switch id="settings-kitchen" checked={draft.print_kitchen_tickets} onCheckedChange={(value) => change({ print_kitchen_tickets: value })} />
        </div>

        <DineInCard
          enabled={draft.dine_in_enabled}
          serviceCharge={draft.service_charge}
          onChange={change}
          enabledError={server?.firstError('dine_in_enabled') ?? null}
          serviceChargeError={serviceCharge.error ?? server?.firstError('service_charge_bps') ?? null}
        />

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            className="w-fit"
            disabled={hasBlankLine}
            onClick={() =>
              void testing.printSample({
                receipt_header_lines: draft.receipt_header_lines.map((line) => line.trim()),
                receipt_footer_lines: draft.receipt_footer_lines.map((line) => line.trim()),
              })
            }
          >
            <PrinterIcon aria-hidden="true" />
            Print sample
          </Button>
          <PrintJobList tracker={testing.tracker} notices={testing.notice ? [testing.notice] : []} title="Sample print" />
        </div>
      </Card>

      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
        <Button variant="outline" size="lg" onClick={() => setDraft(draftFrom(settings))} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="green" size="lg" disabled={save.isPending || hasBlankLine || serviceCharge.bps === null}>
          {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

/** Dine-in Tables & Tabs §I: the on/off switch and the service charge %. */
function DineInCard({
  enabled,
  serviceCharge,
  onChange,
  enabledError,
  serviceChargeError,
}: {
  enabled: boolean;
  serviceCharge: string;
  onChange: (update: Partial<Draft>) => void;
  enabledError: string | null;
  serviceChargeError: string | null;
}) {
  return (
    <section aria-labelledby="settings-dine-in-title" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="settings-dine-in-title" className="flex items-center gap-2 text-base font-semibold">
            <ArmchairIcon className="size-4" aria-hidden="true" />
            Dine-in
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Guests order in rounds at a table and pay at the end. Off: the POS works as pay-now only.
          </p>
          <FieldError message={enabledError} />
        </div>
        <Switch
          id="settings-dine-in"
          aria-label="Dine-in tables"
          checked={enabled}
          onCheckedChange={(value) => onChange({ dine_in_enabled: value })}
        />
      </div>
      <FormField
        label="Service charge (%)"
        error={serviceChargeError}
        hint="Added to bills paid from a table, 0 to 20%. 0 means no service charge."
        className="max-w-60"
      >
        <Input
          inputMode="decimal"
          autoComplete="off"
          maxLength={6}
          value={serviceCharge}
          onChange={(event) => onChange({ service_charge: event.target.value })}
        />
      </FormField>
      <Link to="/tables" className="w-fit text-sm font-medium text-green underline-offset-4 hover:underline">
        Manage tables
      </Link>
    </section>
  );
}
