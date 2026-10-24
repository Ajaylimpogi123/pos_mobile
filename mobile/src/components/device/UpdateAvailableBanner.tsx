import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { colors, iconSizes, spacing, typography } from '@/constants/theme';
import { useVersionGate } from '@/hooks/device/useVersionGate';

/**
 * Hardening & Pilot §D: a dismissible **Update available** banner above the
 * signed-in content, shown once per `latest_version`.
 */
export function UpdateAvailableBanner() {
  const gate = useVersionGate();
  if (!gate.showBanner || !gate.info) return null;
  const url = gate.info.update_url;

  return (
    <SafeAreaView edges={['top', 'right']} style={styles.safe} testID="update-available-banner">
      <View style={styles.row} accessibilityRole="summary">
        <Icon name="information-circle" size={iconSizes.md} color={colors.info} />
        <Text style={styles.text}>Version {gate.info.latest_version} of the app is available.</Text>
        {url ? (
          <Button title="Update" variant="ghost" onPress={() => void Linking.openURL(url).catch(() => undefined)} testID="update-available-open" />
        ) : null}
        <IconButton icon="close" accessibilityLabel="Dismiss update notice" onPress={gate.dismissBanner} testID="update-available-dismiss" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.infoSoft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  text: {
    ...typography.bodySm,
    color: colors.infoText,
    flex: 1,
  },
});
