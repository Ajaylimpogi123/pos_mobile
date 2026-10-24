/**
 * Purchase Request & Order PDF (v1.24 §B/§F): the shared print layout.
 * - `PrintShell`: the page outside the app shell. On screen, a toolbar
 *   (Print / Save as PDF, Back, extra controls such as the PO supplier picker)
 *   over a white A4 sheet; in print, only the sheet. It sets the `@page`
 *   size (A4 portrait, 14 mm) and the
 *   footer "Printed {date, time} by {user} · {number} · Page n of m" in the
 *   page margin boxes. Browsers without margin boxes get the footer once at
 *   the end of the document instead (no page numbers).
 * - The pieces: letterhead, title block, NOT APPROVED band, details grid,
 *   totals, signature lines, a plain chip, and the states (§E).
 * Black text on white, with the brand green (MASTER §1.2) as the one accent.
 */
import { ArrowLeftIcon, LoaderCircleIcon, PrinterIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A CSS string literal (the footer text goes into `content:`): quotes and backslashes escaped, no line breaks. */
function cssString(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ')}"`;
}

/** Chromium (Chrome, Edge) prints `@page` margin boxes; elsewhere the footer goes at the end of the document. */
function supportsMarginBoxes(): boolean {
  return typeof navigator !== 'undefined' && /\b(Chrome|Chromium|Edg)\//.test(navigator.userAgent);
}

type PrintShellProps = {
  /** "Printed 12 Oct 2026, 3:04 PM by Ana · PR-MAIN-2026-00003" (the page numbers are added). */
  footer: string;
  backTo: string;
  backLabel: string;
  /** The data has loaded: Print is enabled. */
  ready: boolean;
  /** Extra toolbar controls (the PO supplier picker). */
  toolbar?: ReactNode;
  children: ReactNode;
};

export function PrintShell({ footer, backTo, backLabel, ready, toolbar, children }: PrintShellProps) {
  const pageCss = `@page { size: A4 portrait; margin: 14mm; @bottom-center { content: ${cssString(`${footer} · Page `)} counter(page) " of " counter(pages); font-size: 8pt; } }`;
  const marginBoxes = supportsMarginBoxes();

  return (
    <div className="min-h-dvh bg-muted print:min-h-0 print:bg-print-paper">
      <style>{pageCss}</style>
      <div
        role="toolbar"
        aria-label="Print"
        className="sticky top-0 z-10 flex flex-wrap items-end gap-3 border-b border-border bg-card px-4 py-3 shadow-card print:hidden"
      >
        <Button asChild variant="outline">
          <Link to={backTo}>
            <ArrowLeftIcon aria-hidden="true" />
            {backLabel}
          </Link>
        </Button>
        {toolbar}
        <div className="ml-auto flex items-center gap-3">
          <Button variant="green" size="lg" onClick={() => window.print()} disabled={!ready}>
            <PrinterIcon aria-hidden="true" />
            Print / Save as PDF
          </Button>
        </div>
      </div>
      <div className="flex justify-center p-6 print:block print:p-0">
        <article
          className="flex w-[210mm] max-w-full flex-col gap-5 bg-print-paper p-[14mm] text-[12px] leading-snug text-print-ink shadow-card print:w-auto print:max-w-none print:p-0 print:shadow-none"
        >
          {children}
          <p className={cn('border-t border-print-ink/20 pt-2 text-[10px]', marginBoxes ? 'print:hidden' : null)}>{footer}</p>
        </article>
      </div>
    </div>
  );
}

/** The letterhead (left) and the title block (right). */
export function PrintHeader({ letterhead, title, number, chips }: { letterhead: string[]; title: string; number: string; chips: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 border-green pb-3">
      <div className="min-w-0">
        {letterhead.map((line, index) => (
          <p key={index} className={index === 0 ? 'text-[15px] font-bold' : 'text-[11px]'}>
            {line}
          </p>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <h1 className="text-[18px] font-bold tracking-wide text-green">{title}</h1>
        <p className="text-[13px] font-semibold tabular">{number}</p>
        <div className="flex flex-wrap justify-end gap-1">{chips}</div>
      </div>
    </header>
  );
}

/** A status word in a thin outline (no fill: it prints the same in black and white). */
export function PrintChip({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-print-ink px-2 py-0.5 text-[10px] font-semibold uppercase">{children}</span>;
}

/** §C.6 / §D.7: the NOT APPROVED band under the title, with an optional reason line. */
export function NotApprovedBand({ text, reason }: { text: string; reason?: string | null }) {
  return (
    <div role="note" className="print-avoid-break border-2 border-print-ink px-3 py-1.5 text-center">
      <p className="text-[12px] font-bold tracking-wide">{text}</p>
      {reason ? <p className="text-[11px]">Decline reason: {reason}</p> : null}
    </div>
  );
}

export type DetailEntry = { label: string; value: ReactNode; full?: boolean };

/** The details, in two columns (a `full` entry spans both). */
export function DetailsGrid({ entries }: { entries: DetailEntry[] }) {
  return (
    <dl className="print-avoid-break grid grid-cols-2 gap-x-8 gap-y-2">
      {entries.map((entry) => (
        <div key={entry.label} className={cn('flex gap-2', entry.full ? 'col-span-2' : null)}>
          <dt className="w-32 shrink-0 font-semibold">{entry.label}</dt>
          <dd className="min-w-0 break-words">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Table header / cell classes shared by the two documents. */
export const printTh = 'border-b-2 border-print-ink px-1.5 py-1 text-left align-bottom text-[10px] font-bold uppercase';
export const printTd = 'border-b border-print-ink/20 px-1.5 py-1 align-top';

/** Right-aligned totals: label and value rows; `strong` rows are bold. */
export function PrintTotals({ rows }: { rows: { label: string; value: string; strong?: boolean }[] }) {
  return (
    <div className="print-avoid-break ml-auto flex w-80 max-w-full flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className={cn('flex justify-between gap-4', row.strong ? 'border-t-2 border-print-ink pt-1 text-[13px] font-bold' : null)}>
          <span>{row.label}</span>
          <span className="tabular">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Signature lines: a role, the name (blank when unknown), and room for a signature and a date. */
export function SignatureLines({ entries }: { entries: { role: string; name: string | null }[] }) {
  return (
    <div className="print-avoid-break mt-6 grid gap-8" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
      {entries.map((entry) => (
        <div key={entry.role} className="flex flex-col gap-1">
          <p className="font-semibold">{entry.role}</p>
          <div className="mt-8 border-b border-print-ink" />
          <p className="min-h-4 text-[11px]">{entry.name ?? ''}</p>
          <p className="text-[10px]">Signature over printed name</p>
          <div className="mt-5 border-b border-print-ink" />
          <p className="text-[10px]">Date</p>
        </div>
      ))}
    </div>
  );
}

/** §E loading: a spinner (the print dialog waits). */
export function PrintLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-6" aria-busy="true">
      <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
        <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
        {label}
      </p>
    </div>
  );
}

/** §E errors: the message, Retry for anything but a 404 / 403, and Back. */
export function PrintError({ message, onRetry, backTo, backLabel }: { message: string; onRetry?: () => void; backTo: string; backLabel: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted p-6">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-lg bg-card p-8 text-center shadow-card">
        <p className="font-semibold">{message}</p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to={backTo}>
              <ArrowLeftIcon aria-hidden="true" />
              {backLabel}
            </Link>
          </Button>
          {onRetry ? (
            <Button variant="green" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
