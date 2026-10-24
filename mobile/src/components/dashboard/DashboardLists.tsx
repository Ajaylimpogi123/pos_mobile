import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import { Icon } from '@/components/ui/Icon';
import { editProductRoute } from '@/constants/routes';
import { colors, hitTarget, iconSizes, sizes, spacing, typography } from '@/constants/theme';
import type { DashboardLowMarginProduct, DashboardRecentChange, DashboardRecentLogin } from '@/services/types';
import { formatRelativeTime } from '@/utils/dates';
import { formatPeso } from '@pos/core/money';
import { formatPercentBps } from '@pos/core/numbers';

function EmptyLine({ text, testID }: { text: string; testID: string }) {
  return (
    <Text style={styles.empty} testID={testID}>
      {text}
    </Text>
  );
}

function Row({ children, first, testID }: { children: ReactNode; first: boolean; testID: string }) {
  return (
    <View style={[styles.row, !first && styles.divider]} testID={testID}>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------

type LowMarginListProps = {
  products: readonly DashboardLowMarginProduct[];
  thresholdBps: number;
  /** With `product.manage`, a row opens that product's edit screen. */
  canEdit: boolean;
};

/** "Lowest margins": products under the threshold, lowest first (max 5, from the server). */
export function LowMarginList({ products, thresholdBps, canEdit }: LowMarginListProps) {
  const threshold = formatPercentBps(thresholdBps, 0);
  return (
    <SectionCard
      title="Lowest margins"
      subtitle={`Products under the ${threshold} target`}
      testID="dashboard-low-margins"
    >
      {products.length === 0 ? (
        <EmptyLine text={`No products under the ${threshold} target.`} testID="dashboard-low-margins-empty" />
      ) : (
        <View>
          {products.map((product, index) => {
            const content = (
              <>
                <View style={styles.main}>
                  <Text style={styles.primary} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={styles.secondary} numberOfLines={1}>
                    {product.category_name} · {formatPeso(product.price_cents)} · cost {formatPeso(product.cost_cents)}
                  </Text>
                </View>
                <Text style={styles.metric} testID={`low-margin-${product.id}-margin`}>
                  {formatPercentBps(product.margin_bps)}
                </Text>
                {canEdit ? <Icon name="chevron-forward" size={iconSizes.sm} color={colors.textSecondary} /> : null}
              </>
            );
            if (!canEdit) {
              return (
                <Row key={product.id} first={index === 0} testID={`low-margin-${product.id}`}>
                  {content}
                </Row>
              );
            }
            return (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                accessibilityLabel={`${product.name}, ${product.category_name}, margin ${formatPercentBps(product.margin_bps)}`}
                accessibilityHint="Opens the product"
                onPress={() => router.push(editProductRoute(product.id))}
                testID={`low-margin-${product.id}`}
                style={({ pressed }) => [styles.row, index > 0 && styles.divider, pressed && styles.pressed]}
              >
                {content}
              </Pressable>
            );
          })}
        </View>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

/** "Recent logins": the latest 5 staff logins in the branch. */
export function RecentLoginsList({ logins, now }: { logins: readonly DashboardRecentLogin[]; now: number }) {
  return (
    <SectionCard title="Recent logins" testID="dashboard-recent-logins">
      {logins.length === 0 ? (
        <EmptyLine text="No logins yet." testID="dashboard-recent-logins-empty" />
      ) : (
        <View>
          {logins.map((login, index) => (
            <Row key={`${login.user_id}-${login.last_login_at}`} first={index === 0} testID={`recent-login-${login.user_id}`}>
              <View style={styles.main}>
                <Text style={styles.primary} numberOfLines={1}>
                  {login.name}
                </Text>
                <Text style={styles.secondary} numberOfLines={1}>
                  {login.role_name}
                </Text>
              </View>
              <Text style={styles.time}>{formatRelativeTime(login.last_login_at, now) ?? '—'}</Text>
            </Row>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

/** "Recent changes": the latest audit entries (not logins), newest first. */
export function RecentChangesList({ changes, now }: { changes: readonly DashboardRecentChange[]; now: number }) {
  return (
    <SectionCard title="Recent changes" testID="dashboard-recent-changes">
      {changes.length === 0 ? (
        <EmptyLine text="No changes yet." testID="dashboard-recent-changes-empty" />
      ) : (
        <View>
          {changes.map((change, index) => (
            <Row key={change.id} first={index === 0} testID={`recent-change-${change.id}`}>
              <View style={styles.main}>
                <Text style={styles.primary} numberOfLines={2}>
                  {change.summary}
                </Text>
                <Text style={styles.secondary} numberOfLines={1}>
                  {change.actor_name} · {formatRelativeTime(change.created_at, now) ?? '—'}
                </Text>
              </View>
            </Row>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  row: {
    minHeight: hitTarget.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.divider,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  main: {
    flex: 1,
    gap: spacing.xxs,
  },
  primary: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  secondary: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metric: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  time: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
