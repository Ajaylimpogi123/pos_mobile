/**
 * Badge (ported from the legacy `Components/ui/badge.jsx`) and the MASTER
 * §1.3 StatusBadge. Both are 24 px tall with a 6 px radius (MASTER §6 Tags vs status):
 * - `Badge` is a **tag** (stock mode, SC/PWD, "Default kitchen", "PIN set",
 *   counts): neutral or outline, no dot, no status tint.
 * - `StatusBadge` is a **state**: the status tint + border + dot + word.
 *   Status is never shown by colour alone.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold whitespace-nowrap tabular',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-accent text-foreground',
        outline: 'border-border bg-card text-foreground',
        success: 'border-success-border bg-success-bg text-success',
        warning: 'border-warning-border bg-warning-bg text-warning',
        danger: 'border-danger-border bg-danger-bg text-danger',
        info: 'border-info-border bg-info-bg text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** The two tag tones (no status tint). */
export type TagTone = Extract<BadgeTone, 'neutral' | 'outline'>;

/** A tag: neutral or outline, never a status tint and never a dot. */
function Badge({ className, tone, ...props }: React.ComponentProps<'span'> & { tone?: TagTone }) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type StatusBadgeProps = {
  tone: Exclude<BadgeTone, 'neutral' | 'outline'>;
  /** The word (or a node holding it, e.g. a visible count plus its spoken meaning). */
  label: React.ReactNode;
  className?: string;
};

/** A state: dot + word on the status tint (MASTER §1.3). */
function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone }), className)}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants, StatusBadge };
