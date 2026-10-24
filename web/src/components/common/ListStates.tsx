/**
 * The four states every list has (MASTER §4): loading (skeletons,
 * `aria-busy`), empty (a helpful message), error (message + Retry), and the
 * cursor "Load more" footer with "Showing n".
 */
import { CircleAlertIcon, InboxIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

export function LoadingRows({ rows = 5, className, label = 'Loading…' }: { rows?: number; className?: string; label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className={cn('flex flex-col gap-2 p-4', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <InboxIcon className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-semibold">{title}</p>
      {message ? <p className="max-w-md text-sm text-muted-foreground">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, title = "Couldn't load this" }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <CircleAlertIcon className="size-8 text-danger" aria-hidden="true" />
      <p className="font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  );
}

type LoadMoreProps = {
  shown: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** An error from the last "Load more". */
  error?: string | null;
  noun?: string;
  /** The total, only where the API returns one (MASTER §6): "Showing n of N". */
  total?: number | null;
};

export function LoadMoreFooter({ shown, hasMore, loading, onLoadMore, error, noun = 'items', total = null }: LoadMoreProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular" aria-live="polite">
        Showing {shown}
        {total !== null ? ` of ${total}` : ''} {noun}
      </span>
      {error ? <span className="text-danger">{error}</span> : null}
      {hasMore ? (
        <Button variant="outline" onClick={onLoadMore} disabled={loading}>
          {loading ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
          {loading ? 'Loading…' : error ? 'Retry' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
