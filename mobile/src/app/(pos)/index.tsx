import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/LoadingState';
import { Screen } from '@/components/Screen';
import { colors, fontSizes, fontWeights, radii, sizes, spacing } from '@/constants/theme';
import { signOut } from '@/services/session';
import { useSessionStore } from '@/stores/session';

/** Phase 0 placeholder: who is signed in, on which device, with which permissions. */
export default function PosHomeScreen() {
  const user = useSessionStore((state) => state.user);
  const isOffline = useSessionStore((state) => state.isOffline);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmLogout() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setConfirmVisible(false);
    }
  }

  if (!user) {
    return <LoadingState />;
  }

  return (
    <Screen scroll centered testID="pos-home">
      <Card style={styles.card}>
        {isOffline ? (
          <Banner
            variant="info"
            message="Offline: showing your saved session. Some details may be out of date."
            testID="offline-banner"
          />
        ) : null}

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.name} accessibilityRole="header">
              {user.name}
            </Text>
            <Text style={styles.muted}>{user.email}</Text>
          </View>
          <Button
            title="Log out"
            variant="danger"
            onPress={() => setConfirmVisible(true)}
            style={styles.logout}
            testID="logout-button"
          />
        </View>

        <View style={styles.details}>
          <Detail label="Role" value={user.role.name} />
          <Detail label="Branch" value={`${user.branch.name} (${user.branch.code})`} />
          <Detail label="Device" value={`${user.device.name} (${user.device.code})`} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          {user.permissions.length > 0 ? (
            <View style={styles.chips}>
              {user.permissions.map((permission) => (
                <Chip key={permission} label={permission} />
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>No permissions assigned.</Text>
          )}
        </View>

        <Banner variant="info" message="The POS menu and cart arrive in a later phase." />
      </Card>

      <ConfirmDialog
        visible={confirmVisible}
        title="Log out?"
        message="You will need your email, password and the device code to log back in."
        confirmLabel="Log out"
        confirmVariant="danger"
        busy={signingOut}
        onConfirm={() => void confirmLogout()}
        onCancel={() => setConfirmVisible(false)}
        testID="logout-dialog"
      />
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: sizes.contentCardMaxWidth,
    gap: spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  muted: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
  },
  logout: {
    minWidth: sizes.actionButtonMinWidth,
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  detail: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: sizes.actionButtonMinWidth,
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  detailLabel: {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  detailValue: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
