/**
 * Tables (Table Management §A/§F): always in the sidebar for `settings.manage`
 * or `report.view`. Up to four tabs, each shown by permission, opening on the
 * first one the user can see (`?tab=` keeps the choice in the address):
 * - **Board** (`report.view`): the live status board;
 * - **Reservations** (`sale.create`);
 * - **Floor plan** (`settings.manage`): the editor; leaving it with unsaved
 *   changes asks first;
 * - **List** (`settings.manage`): the admin list of v1.26.
 * The page only arranges them; the logic lives in the components and hooks.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { FloorPlanEditor } from '@/components/tables/FloorPlanEditor';
import { ReservationsPanel } from '@/components/tables/ReservationsPanel';
import { TablesBoard } from '@/components/tables/TablesBoard';
import { TablesList } from '@/components/tables/TablesList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFloorPlanEditor } from '@/hooks/useFloorPlanEditor';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS, type PermissionSlug } from '@/utils/permissions';

type TablesTab = 'board' | 'reservations' | 'floor' | 'list';

const TABS: readonly { key: TablesTab; label: string; permission: PermissionSlug }[] = [
  { key: 'board', label: 'Board', permission: PERMISSIONS.reportView },
  { key: 'reservations', label: 'Reservations', permission: PERMISSIONS.saleCreate },
  { key: 'floor', label: 'Floor plan', permission: PERMISSIONS.settingsManage },
  { key: 'list', label: 'List', permission: PERMISSIONS.settingsManage },
];

export function TablesPage() {
  useShellHeader('Tables');
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const visible = TABS.filter((tab) => hasPermission(user, tab.permission));
  const requested = visible.find((tab) => tab.key === params.get('tab'));
  const current = requested?.key ?? visible[0]?.key ?? null;
  const [floorDirty, setFloorDirty] = useState(false);
  const guard = useLeaveGuard(floorDirty);

  function choose(next: string) {
    if (next === current) return;
    const go = () => {
      setFloorDirty(false);
      setParams({ tab: next }, { replace: true });
    };
    if (current === 'floor') guard.confirm(go);
    else go();
  }

  return (
    <PageBand title="Tables">
      {current === null ? (
        <EmptyState title="Nothing to show" message="Your role can't use any part of Tables. Ask a manager for access." />
      ) : (
        <Tabs value={current} onValueChange={choose} className="gap-5">
          <TabsList aria-label="Tables">
            {visible.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {current === 'board' ? (
            <TabsContent value="board">
              <TablesBoard />
            </TabsContent>
          ) : null}
          {current === 'reservations' ? (
            <TabsContent value="reservations">
              <ReservationsPanel onSeated={(tab) => void navigate(`/sell?view=tables&tab=${encodeURIComponent(tab.ulid)}`)} />
            </TabsContent>
          ) : null}
          {current === 'floor' ? (
            <TabsContent value="floor">
              <FloorTab confirmLeave={guard.confirm} onDirtyChange={setFloorDirty} />
            </TabsContent>
          ) : null}
          {current === 'list' ? (
            <TabsContent value="list">
              <TablesList />
            </TabsContent>
          ) : null}
        </Tabs>
      )}
      <ConfirmDialog
        open={guard.pending}
        onClose={guard.stay}
        title="Leave without saving?"
        description="Your floor plan changes aren't saved. They are lost if you leave now."
        confirmLabel="Discard changes"
        pendingLabel="Leaving…"
        pending={false}
        error={null}
        onConfirm={guard.leave}
      />
    </PageBand>
  );
}

/** The editor, reporting its unsaved state to the page (the leave guard). */
function FloorTab({ confirmLeave, onDirtyChange }: { confirmLeave: (run: () => void) => void; onDirtyChange: (dirty: boolean) => void }) {
  const editor = useFloorPlanEditor();
  const dirty = editor.dirty;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  return <FloorPlanEditor editor={editor} confirmLeave={confirmLeave} />;
}
