import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PaneHeader } from '@/components/shared/PaneHeader';
import { Banner } from '@/components/ui/Banner';
import { IconButton } from '@/components/ui/IconButton';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { layout } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

type FormLayoutProps = {
  title: string;
  /** A short line under the title (e.g. the record's name), shown only where there is room. */
  subtitle?: string | null;
  onBack: () => void;
  /** Non-field error shown above the form. */
  banner: string | null;
  /** A success notice shown above the form (e.g. "PIN removed."). */
  notice?: string | null;
  /** The main column: field cards and their actions. */
  main: ReactNode;
  /**
   * An optional side card (e.g. the image panel, or a security/actions card).
   * Tablet landscape: beside `main`. Otherwise: stacked with it.
   */
  aside?: ReactNode;
  /** `start`: left of / above `main`. `end`: right of / below `main`. */
  asidePlacement?: 'start' | 'end';
  /** Actions under both panes (e.g. the Create button of a two-pane form). */
  footer?: ReactNode;
  /**
   * Render inside another screen's detail pane (Settings on tablets): no
   * Screen, no top bar and no back button; the title and subtitle show as the
   * pane heading, and every card stacks in one column.
   */
  embedded?: boolean;
  /** Dialogs (rendered outside the scroll view). */
  children?: ReactNode;
  testID?: string;
};

/**
 * Layout for every create / edit form.
 * - Phones and tablet portrait: one centred column (max `formMaxWidth`, ≈480).
 * - Tablet landscape with an `aside`: two panes (max 960), side by side.
 * - KeyboardAvoidingView + ScrollView keeps inputs above the keyboard; the
 *   top bar pads the top/left/right safe areas, the body pads the rest.
 * - `embedded`: the same cards in a detail pane (see the prop).
 *
 * Rotation re-lays out in place: form state lives in the form hook above this
 * component, and each pane keeps the same position in the tree in both
 * layouts (only styles change), so inputs keep their text, focus and the
 * scroll position.
 */
export function FormLayout({
  title,
  subtitle,
  onBack,
  banner,
  notice,
  main,
  aside,
  asidePlacement = 'start',
  footer,
  embedded = false,
  children,
  testID,
}: FormLayoutProps) {
  const { isTwoPane, formMaxWidth, screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const scrollRef = useRef<ScrollView>(null);
  const twoPane = !embedded && isTwoPane && aside != null;

  // A new banner or notice scrolls to the top so it is seen.
  useEffect(() => {
    if (banner || notice) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [banner, notice]);

  const asidePane = aside != null ? <View style={twoPane ? styles.asidePane : styles.fullWidth}>{aside}</View> : null;

  const content = (
    <View
      style={[
        styles.inner,
        { gap: gutter, maxWidth: embedded || twoPane ? layout.formWideMaxWidth : formMaxWidth },
        embedded && styles.innerEmbedded,
      ]}
    >
      {embedded ? <PaneHeader title={title} description={subtitle} testID="form-pane-header" /> : null}
      {banner ? <Banner message={banner} testID="form-banner" /> : null}
      {notice ? <Banner message={notice} variant="success" testID="form-notice" /> : null}
      <View style={[twoPane ? styles.panesRow : styles.panesColumn, { gap: gutter }]}>
        {asidePlacement === 'start' ? asidePane : null}
        <View style={[twoPane ? styles.mainPane : styles.fullWidth, { gap: gutter }]}>{main}</View>
        {asidePlacement === 'end' ? asidePane : null}
      </View>
      {footer ? <View style={[styles.footer, twoPane && styles.footerWide]}>{footer}</View> : null}
    </View>
  );

  if (embedded) {
    return (
      <View style={styles.body} testID={testID}>
        <KeyboardScrollView scrollRef={scrollRef} contentContainerStyle={{ paddingBottom: screenPaddingY }} testID="form-scroll">
          {content}
        </KeyboardScrollView>
        {children}
      </View>
    );
  }

  return (
    <Screen edges={[]} testID={testID}>
      <TopBar
        title={title}
        subtitle={subtitle}
        left={<IconButton icon="arrow-back" variant="bar" accessibilityLabel="Back" onPress={onBack} testID="form-back" />}
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        <KeyboardScrollView
          scrollRef={scrollRef}
          contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }}
          testID="form-scroll"
        >
          {content}
        </KeyboardScrollView>
      </SafeAreaView>
      {children}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  inner: {
    width: '100%',
    alignSelf: 'center',
  },
  innerEmbedded: {
    alignSelf: 'flex-start',
  },
  panesRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  panesColumn: {
    flexDirection: 'column',
  },
  asidePane: {
    flex: layout.asidePaneFlex,
  },
  mainPane: {
    flex: layout.mainPaneFlex,
  },
  fullWidth: {
    width: '100%',
  },
  footer: {
    width: '100%',
  },
  footerWide: {
    alignSelf: 'flex-end',
    maxWidth: layout.formMaxWidth,
  },
});
