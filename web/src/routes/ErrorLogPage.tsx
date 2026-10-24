/**
 * Settings → Error log (Hardening & Pilot §B/§E), `system.manage`: error groups
 * from the apps and the server, newest first. The summary (`meta.summary`:
 * open, open fatal, last 24 h) sits on top; filters are status (Open /
 * Resolved), source, level, a message search and a last-seen date range. A row
 * opens the detail with its events, Resolve and Reopen.
 */
import { BugIcon, ClockIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ErrorStatusBadge, LevelBadge } from '@/components/admin/adminParts';
import { ErrorGroupSheet } from '@/components/admin/ErrorGroupSheet';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { StatCard } from '@/components/common/StatCard';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounced } from '@/hooks/useDebounced';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { useErrorLogList } from '@/hooks/useErrorLog';
import type { ErrorGroup, ErrorGroupStatus, ErrorLevel, ErrorSource } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatAgo } from '@/utils/dates';
import { ERROR_LEVEL_LABELS, ERROR_SOURCE_LABELS } from '@pos/core/errors/health';
import { formatCount } from '@pos/core/numbers';

const column = dataTableColumns<ErrorGroup>();

const LEVELS: readonly ErrorLevel[] = ['fatal', 'error', 'warning'];
const SOURCES: readonly ErrorSource[] = ['app', 'server'];
const SEARCH_MAX = 100;

export function ErrorLogPage() {
  useShellHeader('Error log');
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  const [status, setStatus] = useState<ErrorGroupStatus>('open');
  const [source, setSource] = useState<ErrorSource | null>(null);
  const [level, setLevel] = useState<ErrorLevel | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useErrorLogList({ status, source, level, search, from, to });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const summary = list.summary;

  const columns = useMemo<DataTableColumn<ErrorGroup>[]>(
    () => [
      column.display({ id: 'level', header: 'Level', cell: ({ row }) => <LevelBadge level={row.original.level} /> }),
      column.display({
        id: 'message',
        header: 'Message',
        meta: { className: 'max-w-[420px]' },
        cell: ({ row }) => (
          <span className="flex flex-col gap-0.5">
            <span className="line-clamp-2 font-medium break-words">{row.original.message}</span>
            <span className="text-[13px] text-muted-foreground">
              {ERROR_SOURCE_LABELS[row.original.source]}
              {row.original.latest.screen ? ` · ${row.original.latest.screen}` : ''}
            </span>
          </span>
        ),
      }),
      column.display({
        id: 'occurrences',
        header: 'Count',
        meta: { align: 'right' },
        cell: ({ row }) => <span className="tabular">{formatCount(row.original.occurrences)}</span>,
      }),
      column.display({
        id: 'last',
        header: 'Last seen',
        cell: ({ row }) => <span className="whitespace-nowrap">{formatAgo(row.original.last_seen_at) ?? row.original.last_seen_at}</span>,
      }),
      column.display({
        id: 'where',
        header: 'Latest on',
        cell: ({ row }) => {
          const latest = row.original.latest;
          if (!latest.device && !latest.user) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="flex flex-col text-[13px]">
              {latest.device ? <span>{latest.device.code}</span> : null}
              {latest.user ? <span className="text-muted-foreground">{latest.user.name}</span> : null}
            </span>
          );
        },
      }),
      column.display({ id: 'status', header: 'Status', cell: ({ row }) => <ErrorStatusBadge status={row.original.status} /> }),
    ],
    [],
  );

  const filtered = source !== null || level !== null || search !== '' || from !== '' || to !== '';

  // MASTER §6: the error detail is a right sheet at ≥ 1280 px and a full page below.
  const detailMode = useDetailMode();
  const showPage = detailMode === 'page' && selectedId !== null;

  return (
    <>
      <div hidden={showPage}>
        <PageBand title="Error log">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Open errors" value={summary ? formatCount(summary.open) : '—'} icon={BugIcon} accent="neutral" footnote="Groups not yet resolved" />
            <StatCard
              label="Open fatal"
              value={summary ? formatCount(summary.open_fatal) : '—'}
              icon={TriangleAlertIcon}
              accent="neutral"
              footnote="Crashes that stopped the app"
            />
            <StatCard label="Last 24 hours" value={summary ? formatCount(summary.last_24h) : '—'} icon={ClockIcon} accent="neutral" footnote="Groups seen in the last day" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <Tabs value={status} onValueChange={(value) => setStatus(value as ErrorGroupStatus)}>
                  <TabsList aria-label="Status">
                    <TabsTrigger value="open">Open</TabsTrigger>
                    <TabsTrigger value="resolved">Resolved</TabsTrigger>
                  </TabsList>
                </Tabs>
                <SearchField
                  id="error-log-search"
                  label="Search messages"
                  value={term}
                  onChange={setTerm}
                  placeholder="Part of the error message"
                  maxLength={SEARCH_MAX}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="error-log-source">Source</Label>
                  <NativeSelect
                    id="error-log-source"
                    className="w-40"
                    value={source ?? ''}
                    onChange={(event) => setSource(event.target.value === '' ? null : (event.target.value as ErrorSource))}
                  >
                    <option value="">All sources</option>
                    {SOURCES.map((value) => (
                      <option key={value} value={value}>
                        {ERROR_SOURCE_LABELS[value]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="error-log-level">Level</Label>
                  <NativeSelect
                    id="error-log-level"
                    className="w-40"
                    value={level ?? ''}
                    onChange={(event) => setLevel(event.target.value === '' ? null : (event.target.value as ErrorLevel))}
                  >
                    <option value="">All levels</option>
                    {LEVELS.map((value) => (
                      <option key={value} value={value}>
                        {ERROR_LEVEL_LABELS[value]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="error-log-from">Last seen from</Label>
                  <Input id="error-log-from" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="w-44" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="error-log-to">to</Label>
                  <Input id="error-log-to" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="w-44" />
                </div>
                {filtered ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSource(null);
                      setLevel(null);
                      setFrom('');
                      setTo('');
                      setTerm('');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
              </div>
            </div>
            {list.loading ? (
              <LoadingRows rows={6} label="Loading the error log…" />
            ) : list.error ? (
              <ErrorState title="Couldn't load the error log" message={list.error} onRetry={list.retry} />
            ) : list.items.length === 0 ? (
              filtered ? (
                <EmptyState title="No matching errors" message="Try another source, level, date range or search." />
              ) : status === 'open' ? (
                <EmptyState title="No open errors" message="Nothing needs attention. New errors from the apps and the server appear here." />
              ) : (
                <EmptyState title="No resolved errors" message="Errors you mark as resolved are listed here." />
              )
            ) : (
              <>
                <DataTable
                  label="Error groups"
                  columns={columns}
                  data={list.items}
                  getRowId={(group) => String(group.id)}
                  onRowClick={(group) => setSelectedId(group.id)}
                  rowLabel={(group) => `${ERROR_LEVEL_LABELS[group.level]}: ${group.message.slice(0, 80)}`}
                />
                <LoadMoreFooter
                  shown={list.items.length}
                  hasMore={list.hasMore}
                  loading={list.loadingMore}
                  onLoadMore={list.loadMore}
                  error={list.loadMoreError}
                  noun="errors"
                />
              </>
            )}
          </Card>

        </PageBand>
      </div>
      <ErrorGroupSheet mode={detailMode} groupId={selectedId} timezone={timezone} onClose={() => setSelectedId(null)} />
    </>
  );
}
