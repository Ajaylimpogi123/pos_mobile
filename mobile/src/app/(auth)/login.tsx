import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { BrandPanel } from '@/components/auth/BrandPanel';
import { LoginForm } from '@/components/auth/LoginForm';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { Screen } from '@/components/ui/Screen';
import { colors, layout, spacing } from '@/constants/theme';
import { useLoginForm } from '@/hooks/useLoginForm';
import { useResponsive } from '@/hooks/useResponsive';

/** The screen pads only the top (a dark-emerald strip under the light status bar); the body pads the rest. */
const TOP_EDGE: readonly Edge[] = ['top'];
const BODY_EDGES: readonly Edge[] = ['left', 'right', 'bottom'];

/**
 * Login, tablet-first and rotation-safe (Sage Emerald).
 * - Tablet landscape: two panes. A flat dark-emerald brand panel (≈ 44%) on the left, the white form card centred on the right.
 * - Tablet portrait and phones: the brand panel stacks above the form as a header with rounded bottom corners.
 * - Compact height (short landscape): a short brand row, tighter paddings; everything scrolls.
 *
 * Rotation re-lays out in place: the form state lives in `useLoginForm()`
 * here, above every layout switch, and the form pane / ScrollView / LoginForm
 * keep the same position in the tree in every layout (the brand panel slots
 * are `null` when unused), so inputs, focus and scroll position survive.
 */
export default function LoginScreen() {
  const form = useLoginForm();
  const { isTwoPane, isTablet, screenPaddingX, screenPaddingY, gutter } = useResponsive();

  return (
    <Screen testID="login-screen" edges={TOP_EDGE} statusBar="light" style={styles.screen}>
      <SafeAreaView edges={BODY_EDGES} style={styles.body}>
        <View style={styles.row} testID={isTwoPane ? 'login-layout-two-pane' : 'login-layout-single'}>
          {isTwoPane ? <BrandPanel variant="side" style={styles.brandPane} testID="login-brand-panel" /> : null}

          <View style={isTwoPane ? styles.formPane : styles.fill}>
            <KeyboardScrollView
              contentContainerStyle={isTwoPane ? [styles.scrollCentered, { padding: spacing.giant }] : styles.scrollStacked}
              testID="login-scroll"
            >
              {isTwoPane ? null : <BrandPanel variant={isTablet ? 'hero' : 'mark'} testID="login-brand-header" />}
              <View
                style={[
                  styles.formWrap,
                  !isTwoPane && { paddingHorizontal: screenPaddingX + spacing.xs, paddingVertical: screenPaddingY + spacing.sm, gap: gutter },
                ]}
              >
                <LoginForm form={form} />
              </View>
            </KeyboardScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.primaryDark,
  },
  body: {
    flex: 1,
    backgroundColor: colors.background,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  fill: {
    flex: 1,
  },
  brandPane: {
    flex: layout.brandPanelFlex,
  },
  formPane: {
    flex: layout.formPaneFlex,
  },
  scrollCentered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollStacked: {
    alignItems: 'stretch',
  },
  formWrap: {
    width: '100%',
    alignItems: 'center',
  },
});
