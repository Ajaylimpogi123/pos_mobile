import type { ReactElement } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SEARCH_MAX_LENGTH } from '@/components/shared/ListFilters';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { LoadingState } from '@/components/ui/LoadingState';
import { colors, hitTarget, iconSizes, layout, opacity, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';

/** Every orientation, so an open sheet never blocks a rotation. */
const SUPPORTED_ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'] as const;

type SearchPickerSheetProps<T> = {
  visible: boolean;
  title: string;
  onClose: () => void;
  search: string;
  onSearchChange: (text: string) => void;
  placeholder: string;
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  empty: { title: string; message: string; icon: IconName };
  testID: string;
};

/**
 * A searchable picker: a bottom sheet on phones, a centred dialog on tablets
 * (as the category picker), with a search box, loading / error with Retry /
 * empty states, and more on scroll.
 */
export function SearchPickerSheet<T>({
  visible,
  title,
  onClose,
  search,
  onSearchChange,
  placeholder,
  items,
  keyOf,
  renderItem,
  loading,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  empty,
  testID,
}: SearchPickerSheetProps<T>) {
  const { isTablet, cardPadding, screenPaddingX, screenPaddingY } = useResponsive();
  const insets = useSafeAreaInsets();

  let content: ReactElement;
  if (loading) content = <LoadingState message="Loading…" />;
  else if (error && items.length === 0) content = <ErrorState message={getErrorMessage(error)} onRetry={onRetry} />;
  else if (items.length === 0) content = <EmptyState title={empty.title} message={empty.message} icon={empty.icon} />;
  else {
    content = (
      <FlatList
        data={items}
        keyExtractor={keyOf}
        renderItem={({ item }) => renderItem(item)}
        onEndReached={() => {
          if (hasMore && !loadingMore) onLoadMore();
        }}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.primaryBright} /> : null}
        contentContainerStyle={{ paddingBottom: isTablet ? cardPadding : insets.bottom + spacing.md }}
        testID={`${testID}-list`}
      />
    );
  }

  return (
    <Modal visible={visible} transparent animationType={isTablet ? 'fade' : 'slide'} supportedOrientations={[...SUPPORTED_ORIENTATIONS]} onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          isTablet ? styles.backdropCentered : styles.backdropBottom,
          isTablet && { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY },
          { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
        <View style={[styles.sheet, isTablet ? styles.sheetDialog : styles.sheetBottom]} testID={testID} accessibilityViewIsModal>
          <View style={[styles.header, { paddingHorizontal: cardPadding }]}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <IconButton icon="close" variant="ghost" accessibilityLabel="Close" onPress={onClose} testID={`${testID}-close`} />
          </View>
          <View style={{ paddingHorizontal: cardPadding, paddingBottom: spacing.sm }}>
            <Input
              label="Search"
              variant="search"
              value={search}
              onChangeText={onSearchChange}
              placeholder={placeholder}
              leftIcon="search"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={SEARCH_MAX_LENGTH}
              testID={`${testID}-search`}
            />
          </View>
          <View style={styles.body}>{content}</View>
        </View>
      </View>
    </Modal>
  );
}

type PickerRowProps = {
  title: string;
  subtitle?: string | null;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  trailing?: ReactElement | null;
  disabled?: boolean;
  testID: string;
};

/** One row of a picker sheet (56 dp): a soft icon tile, a title and a muted line, ✓ when selected. */
export function PickerRow({ title, subtitle, icon, selected, onPress, trailing, disabled = false, testID }: PickerRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed, disabled && styles.rowDisabled]}
      testID={testID}
    >
      <View style={[styles.tile, selected && styles.tileSelected]}>
        <Icon name={icon} size={iconSizes.md} color={selected ? colors.primary : colors.textResting} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {selected ? <Icon name="checkmark-circle" size={iconSizes.lg} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  backdropBottom: {
    justifyContent: 'flex-end',
  },
  backdropCentered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: colors.surface,
    maxHeight: layout.sheetMaxHeight,
    overflow: 'hidden',
    ...shadows.lg,
  },
  sheetBottom: {
    width: '100%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  sheetDialog: {
    width: '100%',
    maxWidth: layout.dialogMaxWidth,
    borderRadius: radius.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  body: {
    flexShrink: 1,
    minHeight: hitTarget.large * 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  more: {
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.large,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  tile: {
    width: sizes.badge.md,
    height: sizes.badge.md,
    borderRadius: radius.inner,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  tileSelected: {
    backgroundColor: colors.surface,
  },
  rowSelected: {
    backgroundColor: colors.selectedRow,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  rowDisabled: {
    opacity: opacity.disabled,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
