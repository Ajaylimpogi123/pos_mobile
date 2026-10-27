import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrinterListScreen } from '@/components/printers/PrinterListScreen';
import { PrintersPanel } from '@/components/printers/PrintersPanel';
import { DineInSettingsScreen } from '@/components/settings/DineInSettingsScreen';
import { ReceiptSettingsScreen } from '@/components/settings/ReceiptSettingsScreen';
import { SettingsNav, type SettingsNavGroup, type SettingsNavKey } from '@/components/settings/SettingsNav';
import { ListHeader } from '@/components/shared/ListHeader';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Screen } from '@/components/ui/Screen';
import { ROUTES, tablesRoute } from '@/constants/routes';
import { layout } from '@/constants/theme';
import { useLogout } from '@/hooks/useLogout';
import { useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** The sections shown in the detail pane (tablets) or pushed as their own screen (phones). */
type PaneKey = 'receipt' | 'printers' | 'dine_in';

function paneOf(value: unknown): PaneKey | null {
  return value === 'receipt' || value === 'printers' || value === 'dine_in' ? value : null;
}

/** `/settings?section=…`: a section pushed as its own screen on phones. */
function sectionHref(section: PaneKey): Href {
  const pathname: string = '/settings';
  return { pathname, params: { section } } as Href;
}

function backToSettings() {
  goBackOr(ROUTES.settings);
}

const STORE_GROUP: SettingsNavGroup = {
  key: 'store',
  label: 'Store',
  entries: [
    { key: 'receipt', label: 'Receipt', icon: 'receipt-outline', hint: 'Shows the receipt header, footer and printing settings' },
    { key: 'printers', label: 'Printers', icon: 'print-outline', hint: 'Shows the branch’s printers' },
    // Dine-in Tables & Tabs §I: the switch and service charge, and the tables (they can be set up while dine-in is off).
    { key: 'dine_in', label: 'Dine-in', icon: 'restaurant-outline', hint: 'Shows the dine-in and service charge settings' },
    { key: 'tables', label: 'Tables', icon: 'grid-outline', hint: 'Opens the table list' },
  ],
};

const STAFF_ENTRY = { key: 'staff', label: 'Staff', icon: 'people-outline', hint: 'Opens the staff list' } as const;
const CUSTOMERS_ENTRY = { key: 'customers', label: 'Customers', icon: 'person-circle-outline', hint: 'Opens the customer list' } as const;

const ACCOUNT_GROUP: SettingsNavGroup = {
  key: 'account',
  label: 'Account',
  entries: [{ key: 'logout', label: 'Log out', icon: 'log-out-outline', hint: 'Asks before logging you out', danger: true }],
};

/**
 * Settings (`settings.manage`; Settings mock), built from the sections that
 * exist: **Store** (Receipt, Printers, Dine-in, Tables), **People** (Staff
 * with `user.manage`, Customers) and **Account** (Log out, in red).
 * - Tablet landscape: grouped navigation cards on the left, the selected
 *   section (Receipt by default) on the right, each pane with its title and
 *   grouped cards.
 * - Tablet portrait: the list, then the selected section in place of it with
 *   an **All settings** back button (Android back too).
 * - Phones: the list, then push navigation (`/settings?section=receipt`, the
 *   Printers screen).
 * Tables, Staff and Customers open their own screens. The selection and the
 * pane keep their tree position across layouts, so rotating keeps the open
 * section and any typed receipt text (the form state lives in the pane).
 */
export function SettingsScreen() {
  const { isTablet, isTwoPane, screenPaddingX, screenPaddingY, gutter, formMaxWidth } = useResponsive();
  const params = useLocalSearchParams<{ section?: string }>();
  const requested = paneOf(params.section);
  const [selected, setSelected] = useState<PaneKey>(requested ?? 'receipt');
  // Tablet portrait: the pane replaces the list once a section is opened.
  const [paneOpen, setPaneOpen] = useState(requested !== null || isTwoPane);
  // Rotating into landscape shows the pane; it stays open when rotating back, so nothing typed is lost.
  const [wasTwoPane, setWasTwoPane] = useState(isTwoPane);
  if (wasTwoPane !== isTwoPane) {
    setWasTwoPane(isTwoPane);
    if (isTwoPane) setPaneOpen(true);
  }
  const canManageStaff = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.userManage));
  const logout = useLogout();
  const portraitPane = isTablet && !isTwoPane && paneOpen;

  useEffect(() => {
    if (!portraitPane) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPaneOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [portraitPane]);

  const onSelect = useLatestCallback((key: SettingsNavKey) => {
    if (key === 'receipt' || key === 'printers' || key === 'dine_in') {
      if (isTablet) {
        setSelected(key);
        setPaneOpen(true);
      } else router.push(key === 'printers' ? ROUTES.printers : sectionHref(key));
    } else if (key === 'tables') router.push(tablesRoute('list'));
    else if (key === 'staff') router.push(ROUTES.staff);
    else if (key === 'customers') router.push(ROUTES.customers);
    else logout.requestLogout();
  });

  const groups: SettingsNavGroup[] = [
    STORE_GROUP,
    { key: 'people', label: 'People', entries: canManageStaff ? [STAFF_ENTRY, CUSTOMERS_ENTRY] : [CUSTOMERS_ENTRY] },
    ACCOUNT_GROUP,
  ];

  const logoutDialog = (
    <ConfirmDialog
      visible={logout.confirmVisible}
      title="Log out?"
      message="You'll need your email and password to log back in."
      confirmLabel="Log out"
      confirmVariant="danger"
      icon="log-out-outline"
      busy={logout.signingOut}
      onConfirm={() => void logout.confirmLogout()}
      onCancel={logout.cancelLogout}
      testID="settings-logout-dialog"
    />
  );

  // Phones: a section opened from the list is its own screen, back to the list.
  if (!isTablet && requested === 'receipt') return <ReceiptSettingsScreen onBack={backToSettings} />;
  if (!isTablet && requested === 'printers') return <PrinterListScreen />;
  if (!isTablet && requested === 'dine_in') return <DineInSettingsScreen onBack={backToSettings} />;

  if (!isTablet) {
    return (
      <Screen edges={[]} testID="settings-screen">
        <ListHeader title="Settings" testIDPrefix="settings" />
        <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }}>
            <View style={[styles.phoneList, { maxWidth: formMaxWidth }]}>
              <SettingsNav groups={groups} activeKey={null} onSelect={onSelect} />
            </View>
          </ScrollView>
        </SafeAreaView>
        {logoutDialog}
      </Screen>
    );
  }

  // Tablets: the nav and the pane keep their slots in every layout (rotation only restyles).
  const showNav = isTwoPane || !paneOpen;
  const showPane = isTwoPane || paneOpen;

  return (
    <Screen edges={[]} testID="settings-screen">
      <ListHeader title="Settings" subtitle="Receipts, printers, dine-in and people" testIDPrefix="settings" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        <View
          style={[isTwoPane ? styles.panes : styles.stack, { gap: gutter, paddingHorizontal: screenPaddingX, paddingTop: screenPaddingY }]}
        >
          {showNav ? (
            <ScrollView
              style={isTwoPane ? styles.nav : styles.fill}
              contentContainerStyle={[{ paddingBottom: screenPaddingY }, !isTwoPane && [styles.phoneList, { maxWidth: formMaxWidth }]]}
              showsVerticalScrollIndicator={false}
            >
              <SettingsNav groups={groups} activeKey={isTwoPane ? selected : null} onSelect={onSelect} />
            </ScrollView>
          ) : null}
          {showPane ? (
            <View style={isTwoPane ? styles.pane : styles.fill} testID={`settings-pane-${selected}`}>
              {portraitPane ? (
                <View style={styles.back}>
                  <Button title="All settings" leftIcon="arrow-back" variant="ghost" onPress={() => setPaneOpen(false)} testID="settings-pane-back" />
                </View>
              ) : null}
              {selected === 'receipt' ? <ReceiptSettingsScreen embedded /> : null}
              {selected === 'printers' ? <PrintersPanel /> : null}
              {selected === 'dine_in' ? <DineInSettingsScreen embedded /> : null}
            </View>
          ) : null}
        </View>
      </SafeAreaView>
      {logoutDialog}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  phoneList: {
    width: '100%',
    alignSelf: 'center',
  },
  panes: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  stack: {
    flex: 1,
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  nav: {
    flex: layout.asidePaneFlex,
    // A navigation column (Settings mock: 300 wide).
    maxWidth: layout.settingsNavWidth,
  },
  pane: {
    flex: layout.mainPaneFlex,
  },
  back: {
    alignItems: 'flex-start',
  },
});
