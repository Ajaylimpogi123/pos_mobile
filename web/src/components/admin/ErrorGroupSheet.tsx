/**
 * Error log → a group's detail (Hardening & Pilot §B/§E): the group, its app
 * versions, Resolve / Reopen, and its latest 50 events, each with the stack in
 * a monospace scroll and its context. Every value is shown as text (no HTML).
 */
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Dash, DetailGrid, DetailItem, ErrorStatusBadge, LevelBadge } from '@/components/admin/adminParts';
import { Banner } from '@/components/common/Banner';
import { DetailPanel } from '@/components/common/DetailPanel';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useErrorGroup, useErrorGroupStatus } from '@/hooks/useErrorLog';
import { getErrorMessage } from '@/services/api';
import type { ClientErrorContext, ErrorEvent, ErrorGroupDetail } from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { ERROR_SOURCE_LABELS } from '@pos/core/errors/health';
import { formatCount } from '@pos/core/numbers';

type Props = {
  groupId: number | null;
  /** `sheet` at ≥ 1280 px, `page` below (MASTER §6, `useDetailMode`). */
  mode: 'sheet' | 'page';
  timezone: string;
  onClose: () => void;
};

export function ErrorGroupSheet({ groupId, mode, timezone, onClose }: Props) {
  const detail = useErrorGroup(groupId);
  return (
    <DetailPanel
      mode={mode}
      open={groupId !== null}
      onClose={onClose}
      sheetClassName="sm:max-w-3xl"
      backLabel="Back to the error log"
      title="Error details"
      description="The error group and its latest occurrences."
    >
        <div className="flex flex-col gap-5">
          {detail.loading ? (
            <LoadingRows rows={6} label="Loading the error…" />
          ) : detail.error ? (
            <ErrorState title="Couldn't load this error" message={detail.error} onRetry={detail.reload} />
          ) : detail.group ? (
            <GroupBody group={detail.group} timezone={timezone} />
          ) : null}
        </div>
    </DetailPanel>
  );
}

function at(iso: string | null, timezone: string): string {
  return iso ? (formatBranchDateTime(iso, timezone) ?? iso) : '—';
}

function GroupBody({ group, timezone }: { group: ErrorGroupDetail; timezone: string }) {
  const status = useErrorGroupStatus();
  const action = group.status === 'open' ? 'resolve' : 'reopen';
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <LevelBadge level={group.level} />
          <ErrorStatusBadge status={group.status} />
          <Badge tone="outline">{ERROR_SOURCE_LABELS[group.source]}</Badge>
        </div>
        <p className="font-mono text-sm break-words whitespace-pre-wrap">{group.message}</p>
      </div>

      <DetailGrid>
        <DetailItem label="Occurrences">
          <span className="tabular">{formatCount(group.occurrences)}</span>
        </DetailItem>
        <DetailItem label="App versions">{group.app_versions.length > 0 ? group.app_versions.join(', ') : <Dash />}</DetailItem>
        <DetailItem label="First seen">{at(group.first_seen_at, timezone)}</DetailItem>
        <DetailItem label="Last seen">{at(group.last_seen_at, timezone)}</DetailItem>
        {group.resolved_at ? (
          <DetailItem label="Resolved" wide>
            {at(group.resolved_at, timezone)}
            {group.resolved_by ? ` by ${group.resolved_by.name}` : ''}
          </DetailItem>
        ) : null}
      </DetailGrid>

      {status.error ? <Banner>{getErrorMessage(status.error)}</Banner> : null}
      <div>
        <Button
          variant={action === 'resolve' ? 'green' : 'outline'}
          disabled={status.isPending}
          onClick={() =>
            status.mutate(
              { id: group.id, action },
              { onSuccess: () => toast.success(action === 'resolve' ? 'Error marked resolved.' : 'Error reopened.') },
            )
          }
        >
          {action === 'resolve' ? <CircleCheckIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
          {status.isPending ? (action === 'resolve' ? 'Resolving…' : 'Reopening…') : action === 'resolve' ? 'Mark resolved' : 'Reopen'}
        </Button>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="error-events-title">
        <h3 id="error-events-title" className="font-semibold">
          Latest occurrences ({group.events.length})
        </h3>
        {group.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No occurrences are kept for this error (older than 90 days).</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {group.events.map((event) => (
              <li key={event.ulid}>
                <EventCard event={event} timezone={timezone} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

const CONTEXT_LABELS: readonly [keyof ClientErrorContext, string][] = [
  ['screen', 'Screen'],
  ['app_version', 'App version'],
  ['os', 'OS'],
  ['os_version', 'OS version'],
  ['device_model', 'Model'],
  ['install_id', 'Install ID'],
];

function EventCard({ event, timezone }: { event: ErrorEvent; timezone: string }) {
  const context = event.context ?? {};
  const extra = context.extra ? Object.entries(context.extra) : [];
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{at(event.occurred_at, timezone)}</span>
        <span className="text-muted-foreground">
          {event.device ? `${event.device.code} · ${event.device.name}` : 'No device'}
          {event.user ? ` · ${event.user.name}` : ''}
        </span>
      </div>
      {event.message ? <p className="font-mono text-[13px] break-words whitespace-pre-wrap">{event.message}</p> : null}
      {event.stack ? (
        <pre
          className="max-h-64 overflow-auto rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed whitespace-pre"
          tabIndex={0}
          aria-label="Stack trace"
        >
          {event.stack}
        </pre>
      ) : (
        <p className="text-[13px] text-muted-foreground">No stack trace.</p>
      )}
      <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
        {CONTEXT_LABELS.map(([key, label]) => {
          const value = context[key];
          if (value === null || value === undefined || value === '') return null;
          return (
            <div key={key} className="flex gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{String(value)}</dd>
            </div>
          );
        })}
        {typeof context.online === 'boolean' ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Network</dt>
            <dd>{context.online ? 'Online' : 'Offline'}</dd>
          </div>
        ) : null}
        {extra.map(([key, value]) => (
          <div key={`extra-${key}`} className="flex gap-2 sm:col-span-2">
            <dt className="shrink-0 text-muted-foreground">{key}</dt>
            <dd className="min-w-0 font-mono break-words whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Received</dt>
          <dd>{at(event.received_at, timezone)}</dd>
        </div>
      </dl>
    </article>
  );
}
