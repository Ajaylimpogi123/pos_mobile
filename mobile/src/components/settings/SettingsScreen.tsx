import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrinterListScreen } from '@/components/printers/PrinterListScreen';
import { PrintersPanel } from '@/components/printers/PrintersPanel';
import { ReceiptSettingsScreen } from '@/components/settings/ReceiptSettingsScreen';
import { SettingsNav, type SettingsNavGroup, type SettingsNavKey } from '@/components/settings/SettingsNav';
import { ListHeader } from '@/components/shared/ListHeader';
import { useLatestCallback } from '@/components/shared/useLatestCallback';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Screen } from '@/components/ui/Screen';
import { ROUTES } from '@/constants/routes';
import { layout } from '@/constants/theme';
import { useLogout } from '@/hooks/useLogout';
import { useResponsive } from '@/hooks/useResponsive';
import { useSessionStore } from '@/stores/session';
import { goBackOr } from '@/utils/navigation';
import { hasPermission, PERMISSIONS } from '@/utils/permissions';

/** The sections shown in the detail pane (tablets) or pushed as their own screen (phones). */
type PaneKey = 'receipt' | 'printers';

function paneOf(value: unknown): PaneKey | null {
  return value === 'receipt' || value === 'printers' ? value : null;
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
 * exist: **Store** (Receipt, Printers), **People** (Staff with `user.manage`,
 * Customers) and **Account** (Log out, in red).
 * - Tablets (both orientations): grouped navigation cards on the left, the
 *   selected section (Receipt by default) on the right. Staff and Customers
 *   open their own screens.
 * - Phones: the list, then push navigation (`/settings?section=receipt`, the
 *   Printers screen, Staff, Customers).
 * The selection is local state above the layout, so rotating keeps it (and
 * any typed receipt text, which lives in the form below).
 */
export function SettingsScreen() {
  const { isTablet, screenPaddingX, screenPaddingY, gutter, formMaxWidth } = useResponsive();
  const params = useLocalSearchParams<{ section?: string }>();
  const requested = paneOf(params.section);
  const [selected, setSelected] = useState<PaneKey>(requested ?? 'receipt');
  const canManageStaff = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.userManage));
  const logout = useLogout();

  const onSelect = useLatestCallback((key: SettingsNavKey) => {
    if (key === 'receipt' || key === 'printers') {
      if (isTablet) setSelected(key);
      else router.push(key === 'receipt' ? sectionHref('receipt') : ROUTES.printers);
    } else if (key === 'staff') router.push(ROUTES.staff);
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

  return (
    <Screen edges={[]} testID="settings-screen">
      <ListHeader title="Settings" subtitle="Receipts, printers and people" testIDPrefix="settings" />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        <View style={[styles.panes, { gap: gutter, paddingHorizontal: screenPaddingX, paddingTop: screenPaddingY }]}>
          <ScrollView style={styles.nav} contentContainerStyle={{ paddingBottom: screenPaddingY }} showsVerticalScrollIndicator={false}>
            <SettingsNav groups={groups} activeKey={selected} onSelect={onSelect} />
          </ScrollView>
          <View style={styles.pane} testID={`settings-pane-${selected}`}>
            {selected === 'receipt' ? <ReceiptSettingsScreen embedded /> : <PrintersPanel />}
          </View>
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
  nav: {
    flex: layout.asidePaneFlex,
    // A navigation column (Settings mock: 300 wide).
    maxWidth: layout.settingsNavWidth,
  },
  pane: {
    flex: layout.mainPaneFlex,
  },
});
