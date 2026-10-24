/**
 * Small shared pieces of the admin Devices and Error log screens (Hardening &
 * Pilot §E). The wording comes from `@pos/core/errors/health`, so the web and
 * the tablet say the same thing; only the badge tones are the web's MASTER §1.3 ones.
 */
import type { ReactNode } from 'react';

import { ToneBadge } from '@/components/common/ToneBadge';
import type { DeviceHealth, ErrorLevel, ErrorGroupStatus } from '@/services/types';
import {
  deviceHealthLabel,
  deviceHealthTone,
  ERROR_LEVEL_LABELS,
  ERROR_LEVEL_TONES,
  ERROR_STATUS_LABELS,
} from '@pos/core/errors/health';

export function HealthBadge({ health }: { health: DeviceHealth }) {
  return <ToneBadge info={{ label: deviceHealthLabel(health), tone: deviceHealthTone(health) }} />;
}

export function LevelBadge({ level }: { level: ErrorLevel }) {
  return <ToneBadge info={{ label: ERROR_LEVEL_LABELS[level], tone: ERROR_LEVEL_TONES[level] }} />;
}

export function ErrorStatusBadge({ status }: { status: ErrorGroupStatus }) {
  return <ToneBadge info={{ label: ERROR_STATUS_LABELS[status], tone: status === 'open' ? 'warning' : 'success' }} />;
}

/** A label/value grid on the `subtle` box (detail sheets). */
export function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-3 rounded-xl bg-subtle p-4 sm:grid-cols-2">{children}</dl>;
}

export function DetailItem({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** "—" for a missing value. */
export function Dash() {
  return <span className="text-muted-foreground">—</span>;
}
