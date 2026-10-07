import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TopBar } from '@/components/ui/TopBar';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import { PinPad } from '@/components/ui/PinPad';
import { Screen } from '@/components/ui/Screen';
import { ROUTES } from '@/constants/routes';
import { colors, pressedScale, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useSwitchUser, type SwitchUserState } from '@/hooks/pin/useSwitchUser';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { PinUser } from '@/services/types';
import { goBackOr } from '@/utils/navigation';

export const SWITCH_OFFLINE_MESSAGE = 'Switching users needs a connection.';

/** "Mia Manager" → "MM". */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase());
  return letters.join('') || '?';
}

function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const size = large ? sizes.badge.lg : sizes.badge.md + spacing.sm;
  return (
    <View style={[styles.avatar, { width: size, height: size }]}>
      <Text style={large ? styles.avatarTextLarge : styles.avatarText}>{initialsOf(name)}</Text>
    </View>
  );
}

function PersonTile({ person, isYou, onPress }: { person: PinUser; isYou: boolean; onPress: () => void }) {
  return (
    <Card style={styles.tile} testID={`pin-user-${person.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${person.name}, ${person.role.name}${isYou ? ', you' : ''}`}
        accessibilityHint="Enter their PIN next"
        onPress={onPress}
        style={({ pressed }) => [styles.tileBody, pressed && styles.pressed]}
        testID={`pin-user-${person.id}-open`}
      >
        <Avatar name={person.name} />
        <Text style={styles.tileName} numberOfLines={2}>
          {person.name}
        </Text>
        <Text style={styles.tileRole} numberOfLines={1}>
          {person.role.name}
        </Text>
        {isYou ? <Chip label="You" variant="primary" /> : null}
      </Pressable>
    </Card>
  );
}

function PickStep({ screen }: { screen: SwitchUserState }) {
  const { kpiColumns, gutter, screenPaddingX, screenPaddingY, contentMaxWidth } = useResponsive();
  const { users } = screen;
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await users.grid.onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      colors={[colors.primaryBright]}
      tintColor={colors.primaryBright}
    />
  );

  if (users.grid.loading) return <LoadingState message="Loading staff…" testID="pin-users-loading" />;
  if (users.grid.error && users.items.length === 0) {
    return (
      <ErrorState
        title="Couldn't load the staff list"
        message={getErrorMessage(users.grid.error)}
        onRetry={users.grid.onRetry}
        refreshControl={refreshControl}
        testID="pin-users-error"
      />
    );
  }

  const footer = (
    <Button
      title="Use email instead"
      leftIcon="mail-outline"
      variant="ghost"
      onPress={screen.emailInstead}
      loading={screen.signingOut}
      testID="switch-use-email"
    />
  );

  if (users.items.length === 0) {
    return (
      <View style={styles.fill}>
        <EmptyState
          title="No one can switch with a PIN yet"
          message="A manager can set PINs in Staff. Until then, sign in with email and password."
          icon="keypad-outline"
          refreshControl={refreshControl}
          testID="pin-users-empty"
        />
        <View style={{ paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY }}>{footer}</View>
      </View>
    );
  }

  return (
    <ScrollView
      refreshControl={refreshControl}
      contentContainerStyle={[
        styles.page,
        { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY, gap: gutter, maxWidth: contentMaxWidth },
      ]}
      testID="pin-users"
    >
      {screen.banner ? <Banner message={screen.banner} testID="switch-banner" /> : null}
      <View style={styles.promptBlock}>
        <Text style={styles.prompt} accessibilityRole="header">
          Who is using this device?
        </Text>
        <Text style={styles.promptHint}>Tap your name, then enter your PIN.</Text>
      </View>
      <DashboardGrid
        cells={users.items.map((person) => ({
          key: String(person.id),
          node: <PersonTile person={person} isYou={person.id === screen.currentUserId} onPress={() => screen.choose(person)} />,
        }))}
        columns={kpiColumns}
        gutter={gutter}
        testID="pin-users-grid"
      />
      {footer}
    </ScrollView>
  );
}

function PinStep({ screen, person }: { screen: SwitchUserState; person: PinUser }) {
  const { screenPaddingX, screenPaddingY, formMaxWidth, isCompactHeight } = useResponsive();

  return (
    <ScrollView
      contentContainerStyle={[styles.pinPage, { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }]}
      testID="switch-pin-step"
    >
      <View style={[styles.pinCard, { maxWidth: Math.min(formMaxWidth, sizes.loginCardWidth) }]}>
        <View style={styles.pinHeader}>
          {isCompactHeight ? null : <Avatar name={person.name} large />}
          <Text style={styles.pinName} accessibilityRole="header" numberOfLines={2} testID="switch-selected">
            {person.name}
          </Text>
          <Text style={styles.tileRole}>{person.role.name}</Text>
        </View>
        <PinPad
          value={screen.pin}
          onChange={screen.setPin}
          accessibilityLabel={`PIN for ${person.name}`}
          disabled={screen.submitting}
          error={screen.pinError}
          testID="switch-pin"
        />
        <Button
          title="Sign in"
          leftIcon="log-in-outline"
          size="lg"
          onPress={screen.submit}
          loading={screen.submitting}
          disabled={!screen.canSubmit}
          testID="switch-submit"
        />
        <Button
          title="Choose someone else"
          variant="ghost"
          onPress={screen.back}
          disabled={screen.submitting}
          testID="switch-back"
        />
      </View>
    </ScrollView>
  );
}

/**
 * Switch user (`/(app)/switch-user`, from the shell): a grid of the people
 * who can sign in with a PIN on this device, then a PIN pad. The cart and the
 * on-device menu are kept; the session becomes the new user's. It needs a
 * connection. "Use email instead" logs out to the login screen.
 * The step and the typed PIN live in `useSwitchUser`, above the layout, so a
 * rotation keeps them.
 */
export function SwitchUserScreen() {
  const screen = useSwitchUser();

  return (
    <Screen edges={[]} testID="switch-user-screen">
      <TopBar
        title="Switch user"
        subtitle="Quick PIN sign-in"
        left={
          <IconButton
            icon="arrow-back"
            variant="bar"
            accessibilityLabel={screen.selected ? 'Choose someone else' : 'Back'}
            onPress={screen.selected ? screen.back : () => goBackOr(ROUTES.home)}
            disabled={screen.submitting}
            testID="switch-header-back"
          />
        }
        testID="switch-header"
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.fill}>
        {screen.online ? null : (
          <View style={styles.offline}>
            <Banner variant="warning" message={SWITCH_OFFLINE_MESSAGE} testID="switch-offline" />
          </View>
        )}
        {screen.selected ? <PinStep screen={screen} person={screen.selected} /> : <PickStep screen={screen} />}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  offline: {
    padding: spacing.lg,
  },
  page: {
    width: '100%',
    alignSelf: 'center',
  },
  promptBlock: {
    gap: spacing.xxs,
  },
  prompt: {
    ...typography.title,
    color: colors.text,
  },
  promptHint: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tile: {
    flex: 1,
  },
  tileBody: {
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  pressed: {
    transform: [{ scale: pressedScale }],
  },
  avatar: {
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.heading,
    color: colors.primaryDark,
  },
  avatarTextLarge: {
    ...typography.title,
    color: colors.primaryDark,
  },
  tileName: {
    ...typography.bodyStrong,
    color: colors.text,
    textAlign: 'center',
  },
  tileRole: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pinPage: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCard: {
    width: '100%',
    gap: spacing.lg,
    padding: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.lg,
  },
  pinHeader: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  pinName: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center',
  },
});
