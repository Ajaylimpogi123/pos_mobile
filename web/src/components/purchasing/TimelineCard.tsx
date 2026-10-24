/**
 * The audit timeline of a PR or PO (§F `timeline[]`, Q-027): each entry's
 * action in plain words (`timelineAction`), who, when (branch time) and the
 * worded details, oldest first as the server sends them.
 */
import { Card } from '@/components/ui/card';
import { timelineAction } from '@/constants/purchasingLabels';
import type { PurchaseTimelineEntry } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';

export function TimelineCard({ entries }: { entries: readonly PurchaseTimelineEntry[] }) {
  const timezone = useSessionStore((state) => state.user?.branch.timezone ?? 'Asia/Manila');
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold">Timeline</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col" aria-label="Timeline">
          {entries.map((entry, index) => {
            const info = timelineAction(entry.action);
            const Icon = info.icon;
            const when = formatBranchDateTime(entry.at, timezone) ?? entry.at;
            return (
              <li key={`${entry.at}-${entry.action}-${index}`} className="flex gap-3 pb-4 last:pb-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <p className="font-medium">{info.label}</p>
                  <p className="text-[13px] text-muted-foreground">{entry.by ? `${entry.by.name} · ${when}` : when}</p>
                  {entry.details ? <p className="text-sm">{entry.details}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
