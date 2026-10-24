/**
 * The sections of "This terminal" (Hardening & Pilot §I, the tablet's §E layout
 * without the outbox and version items): the checklist, Server, This terminal,
 * Printers, Error reports and Send diagnostics.
 */
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import type { CheckState, ChecklistItem } from '@/components/terminal/terminalChecklist';
import { cn } from '@/lib/utils';

const CHECK_ICONS: Record<CheckState, { icon: LucideIcon; className: string; label: string }> = {
  ok: { icon: CircleCheckIcon, className: 'text-success', label: 'OK' },
  warn: { icon: TriangleAlertIcon, className: 'text-warning', label: 'Needs attention' },
  fail: { icon: CircleXIcon, className: 'text-danger', label: 'Problem' },
  pending: { icon: LoaderCircleIcon, className: 'animate-spin text-muted-foreground', label: 'Checking' },
};

export function Checklist({ items }: { items: readonly ChecklistItem[] }) {
  return (
    <Card className="p-0">
      <h2 className="border-b border-border px-5 py-3 text-base font-semibold">Checklist</h2>
      <ul className="divide-y divide-border" aria-live="polite">
        {items.map((item) => {
          const icon = CHECK_ICONS[item.state];
          const Icon = icon.icon;
          return (
            <li key={item.key} className="flex items-start gap-3 px-5 py-3">
              <Icon className={cn('mt-0.5 size-5 shrink-0', icon.className)} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {item.title}
                  <span className="sr-only">: {icon.label}</span>
                </p>
                <p className="text-sm text-muted-foreground">{item.detail}</p>
                {item.hint && item.state !== 'ok' ? <p className="mt-0.5 text-sm font-medium">{item.hint}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

export function Facts({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
