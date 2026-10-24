import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PaneHeader } from '@/components/shared/PaneHeader';
import { Banner } from '@/components/ui/Banner';
import { IconButton } from '@/components/ui/IconButton';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { Screen } from '@/components/ui/Screen';
import { TopBar } from '@/components/ui/TopBar';
import { ErrorSummary, errorItemsFrom, type FieldLabels, type FormErrorItem } from '@/components/ui/ErrorSummary';
import { colors, layout, sizes, spacing } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';

export type { FormErrorItem } from '@/components/ui/ErrorSummary';

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
  /**
   * The sticky footer (back-office.md): **Cancel** (outline) and **Save** (green
   * pill), pinned under the scrolling form so they stay in reach.
   */
  footer?: ReactNode;
  /**
   * After a failed submit: the 422 field messages, shown as a focusable error
   * summary at the top (MASTER §4). Each item names its field; with
   * `onSelectError`, tapping one focuses that field.
   */
  errorSummary?: readonly FormErrorItem[];
  onSelectError?: (field: string) => void;
  /**
   * The form's field errors (request field → message): when there is no
   * explicit `errorSummary`, the summary is built from them (labels from
   * `fieldLabels`, else the field name in words). Field errors only appear after
   * a submit (client checks or a 422), and typing clears them.
   */
  fieldErrors?: Readonly<Record<string, unknown>>;
  fieldLabels?: FieldLabels;
  /**
   * Render inside another screen's detail pane (Settings on tablets): no
   * Screen, no top bar and no back button; the title and subtitle show as the
   * pane heading, and every card stacks in one column.
   */
  embedded?: boolean;
  /** Compact actions on the right of the top bar (e.g. Receive's PDF button). Not shown when `embedded`. */
  headerRight?: ReactNode;
  /** Dialogs (rendered outside the scroll view). */
  children?: ReactNode;
  testID?: string;
};

/**
 * Layout for every create / edit form.
 * - Phones and tablet portrait: one centred column (max 720, back-office.md; no band).
 * - Tablet landscape with an `aside`: two panes (max 960), side by side.
 * - The footer (Cancel / Save) is sticky: it sits under the scroll view.
 * - After a failed submit, `errorSummary` shows a focusable summary at the top.
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
  errorSummary,
  onSelectError,
  fieldErrors,
  fieldLabels,
  embedded = false,
  headerRight,
  children,
  testID,
}: FormLayoutProps) {
  const { isTwoPane, screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const scrollRef = useRef<ScrollView>(null);
  const twoPane = !embedded && isTwoPane && aside != null;

  const summaryItems = useMemo(() => errorSummary ?? errorItemsFrom(fieldErrors, fieldLabels), [errorSummary, fieldErrors, fieldLabels]);
  const hasSummary = summaryItems.length > 0;

  // A new banner, notice or error summary scrolls to the top so it is seen.
  useEffect(() => {
    if (banner || notice || hasSummary) scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [banner, notice, hasSummary]);

  const asidePane = aside != null ? <View style={twoPane ? styles.asidePane : styles.fullWidth}>{aside}</View> : null;

  const content = (
    <View
      style={[
        styles.inner,
        { gap: gutter, maxWidth: embedded || twoPane ? layout.formWideMaxWidth : layout.backOfficeFormMaxWidth },
        embedded && styles.innerEmbedded,
      ]}
    >
      {embedded ? <PaneHeader title={title} description={subtitle} testID="form-pane-header" /> : null}
      {hasSummary ? <ErrorSummary items={summaryItems} onSelect={onSelectError} /> : null}
      {banner ? <Banner message={banner} testID="form-banner" /> : null}
      {notice ? <Banner message={notice} variant="success" testID="form-notice" /> : null}
      <View style={[twoPane ? styles.panesRow : styles.panesColumn, { gap: gutter }]}>
        {asidePlacement === 'start' ? asidePane : null}
        <View style={[twoPane ? styles.mainPane : styles.fullWidth, { gap: gutter }]}>{main}</View>
        {asidePlacement === 'end' ? asidePane : null}
      </View>
    </View>
  );

  const stickyFooter = footer ? (
    <View style={[styles.footerBar, { paddingHorizontal: embedded ? 0 : screenPaddingX }]} testID="form-footer">
      <View
        style={[
          styles.footer,
          { maxWidth: embedded || twoPane ? layout.formWideMaxWidth : layout.backOfficeFormMaxWidth },
          twoPane && styles.footerWide,
        ]}
      >
        {footer}
      </View>
    </View>
  ) : null;

  if (embedded) {
    return (
      <View style={styles.body} testID={testID}>
        <KeyboardScrollView scrollRef={scrollRef} contentContainerStyle={{ paddingBottom: screenPaddingY }} testID="form-scroll">
          {content}
        </KeyboardScrollView>
        {stickyFooter}
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
        right={headerRight}
      />
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.body}>
        <KeyboardScrollView
          scrollRef={scrollRef}
          contentContainerStyle={{ paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY }}
          testID="form-scroll"
        >
          {content}
        </KeyboardScrollView>
        {stickyFooter}
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
  footerBar: {
    paddingVertical: spacing.md,
    borderTopWidth: sizes.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footer: {
    width: '100%',
    alignSelf: 'center',
  },
  footerWide: {
    alignItems: 'flex-end',
  },
});

