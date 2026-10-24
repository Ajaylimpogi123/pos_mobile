/**
 * An inline message (form-level errors, warnings, notices), tinted with the
 * MASTER §1.3 status colours and always with an icon plus text.
 */
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type BannerVariant = 'error' | 'warning' | 'info' | 'success';

const STYLES: Record<BannerVariant, string> = {
  error: 'border-danger-border bg-danger-bg text-danger',
  warning: 'border-warning-border bg-warning-bg text-warning',
  info: 'border-info-border bg-info-bg text-info',
  success: 'border-success-border bg-success-bg text-success',
};

const ICONS = {
  error: CircleAlertIcon,
  warning: TriangleAlertIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
} as const;

type BannerProps = {
  variant?: BannerVariant;
  title?: string;
  children: ReactNode;
  /** Buttons on the right (Retry, Dismiss…). */
  actions?: ReactNode;
  className?: string;
  id?: string;
};

export function Banner({ variant = 'error', title, children, actions, className, id }: BannerProps) {
  const Icon = ICONS[variant];
  return (
    <div
      id={id}
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', STYLES[variant], className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className="font-medium">{children}</div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
