import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ListHeader } from '@/components/shared/ListHeader';
import { FloorPlanEditor } from '@/components/tables/FloorPlanEditor';
import { ReservationsPanel } from '@/components/tables/ReservationsPanel';
import { TableListPanel } from '@/components/tables/TableListScreen';
import { TablesBoard } from '@/components/tables/TablesBoard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import type { TablesPageTab } from '@/constants/routes';
import { layout } from '@/constants/theme';
import { useDineInEnabled } from '@/hooks/tables/useDineIn';
import { useFloorPlanEditor } from '@/hooks/tables/useFloorPlanEditor';
import { useReservations } from '@/hooks/tables/useReservations';
import { useTablesBoard } from '@/hooks/tables/useTablesBoard';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useSessionStore } from '@/stores/session';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

const ALL_TABS: readonly (SegmentOption<TablesPageTab> & { needs: 'board' | 'reserve' | 'manage' })[] = [
  { value: 'board', label: 'Board', icon: 'speedometer-outline', testID: 'tables-tab-board', needs: 'board' },
  { value: 'reservations', label: 'Reservations', icon: 'calendar-outline', testID: 'tables-tab-reservations', needs: 'reserve' },
  { value: 'floor', label: 'Floor plan', icon: 'map-outline', testID: 'tables-tab-floor', needs: 'manage' },
  { value: 'list', label: 'List', icon: 'list-outline', testID: 'tables-tab-list', needs: 'manage' },
];

const SUBTITLES: Record<TablesPageTab, string> = {
  board: 'Live tables and pending bills',
  reservations: 'Bookings by day',
  floor: 'Where each table sits',
  list: 'Tables by area',
};

function isTab(value: unknown): value is TablesPageTab {
  return value === 'board' || value === 'reservations' || value === 'floor' || value === 'list';
}

type LeaveAction = Parameters<Parameters<typeof usePreventRemove>[1]>[0]['data']['action'];
type PendingLeave = { kind: 'tab'; tab: TablesPageTab } | { kind: 'screen'; action: LeaveAction };

/**
 * **Tables** (Table Management §A and §F): up to four tabs, each by
 * permission: **Board** (`report.view`), **Reservations** (`sale.create`),
 * **Floor plan** and **List** (`settings.manage`). It opens on `?tab=` when
 * allowed, else on the first tab the user can see. Board and Reservations
 * need dine-in on; Floor plan and List work while it's off. Leaving the floor
 * plan (another tab or the page) with unsaved changes asks first.
 */
export function TablesScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const navigation = useNavigation();
  const canBoard = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.reportView));
  const canReserve = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.saleCreate));
  const canManage = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.settingsManage));
  const dineIn = useDineInEnabled();
  const online = useIsOnline();

  const allowed = { board: canBoard, reserve: canReserve, manage: canManage };
  const tabs = ALL_TABS.filter((option) => allowed[option.needs]);
  const requested = isTab(params.tab) && tabs.some((option) => option.value === params.tab) ? params.tab : null;
  const [tab, setTab] = useState<TablesPageTab | null>(requested ?? tabs[0]?.value ?? null);
  // A later `?tab=` (e.g. Sell → Reservations while the page is open) switches to it.
  const [seenRequested, setSeenRequested] = useState(requested);
  if (requested !== seenRequested) {
    setSeenRequested(requested);
    if (requested) setTab(requested);
  }

  const editor = useFloorPlanEditor(canManage && tab === 'floor');
  const board = useTablesBoard(canBoard && tab === 'board' && dineIn);
  const reservations = useReservations(canReserve && tab === 'reservations' && dineIn);

  const [leave, setLeave] = useState<PendingLeave | null>(null);
  const leaving = useRef<LeaveAction | null>(null);
  usePreventRemove(editor.dirty, ({ data }) => setLeave({ kind: 'screen', action: data.action }));
  // Once the discarded edits are gone the screen is no longer held, and the navigation goes ahead.
  useEffect(() => {
    const action = leaving.current;
    if (action && !editor.dirty) {
      leaving.current = null;
      navigation.dispatch(action);
    }
  }, [editor.dirty, navigation]);

  function chooseTab(next: TablesPageTab) {
    if (next === tab) return;
    if (tab === 'floor' && editor.dirty) setLeave({ kind: 'tab', tab: next });
    else setTab(next);
  }

  function discardAndLeave() {
    const pending = leave;
    setLeave(null);
    editor.discard();
    if (!pending) return;
    if (pending.kind === 'tab') setTab(pending.tab);
    else leaving.current = pending.action;
  }

  let view: ReactElement | null = null;
  if (tab === 'board') view = <TablesBoard board={board} canSell={canReserve} dineIn={dineIn} />;
  else if (tab === 'reservations') view = <ReservationsPanel state={reservations} dineIn={dineIn} />;
  else if (tab === 'floor') view = <FloorPlanEditor editor={editor} online={online} />;
  else if (tab === 'list') view = <TableListPanel />;

  return (
    <Screen edges={[]} testID="tables-screen">
      <ListHeader band title="Tables" subtitle={tab ? SUBTITLES[tab] : undefined} testIDPrefix="tables">
        {tabs.length > 1 && tab ? (
          <SegmentedControl<TablesPageTab>
            options={tabs}
            value={tab}
            onChange={chooseTab}
            accessibilityLabel="Tables section"
            style={styles.tabs}
            testID="tables-tabs"
          />
        ) : null}
      </ListHeader>
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        {view}
      </SafeAreaView>
      <ConfirmDialog
        visible={leave !== null}
        title="Discard floor plan changes?"
        message="The tables you moved haven't been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        confirmVariant="danger"
        icon="alert-circle-outline"
        onConfirm={discardAndLeave}
        onCancel={() => setLeave(null)}
        testID="floor-leave-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  tabs: {
    maxWidth: layout.formWideMaxWidth,
  },
});
