import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CatalogImage } from '@/components/menu/CatalogImage';
import { PickerField } from '@/components/shared/PickerField';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import {
  colors,
  hitTarget,
  iconSizes,
  layout,
  radius,
  shadows,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { useAllAdminCategories } from '@/hooks/menu/useAdminCategories';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { Category } from '@/services/types';

type CategoryPickerFieldProps = {
  categoryId: number | null;
  categoryName: string;
  onChange: (category: Category) => void;
  error?: string | null;
  disabled?: boolean;
};

/** Every orientation, so an open sheet never blocks a rotation. */
const SUPPORTED_ORIENTATIONS = ['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right'] as const;

/**
 * A field that looks like an Input and opens a list of the admin categories
 * (active and inactive, since a product may sit in an inactive category):
 * a bottom sheet on phones, a centred dialog on tablets.
 */
export function CategoryPickerField({ categoryId, categoryName, onChange, error, disabled = false }: CategoryPickerFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <PickerField
        label="Category"
        value={categoryName}
        placeholder="Choose a category"
        icon="grid-outline"
        onPress={() => setOpen(true)}
        error={error}
        disabled={disabled}
        accessibilityHint="Opens the list of categories"
        testID="category-picker"
      />
      <CategorySheet
        visible={open}
        selectedId={categoryId}
        onClose={() => setOpen(false)}
        onSelect={(category) => {
          onChange(category);
          setOpen(false);
        }}
      />
    </View>
  );
}

type CategorySheetProps = {
  visible: boolean;
  selectedId: number | null;
  onClose: () => void;
  onSelect: (category: Category) => void;
};

function CategorySheet({ visible, selectedId, onClose, onSelect }: CategorySheetProps) {
  const { isTablet, cardPadding, screenPaddingX, screenPaddingY } = useResponsive();
  const insets = useSafeAreaInsets();
  const query = useAllAdminCategories();

  let content;
  if (query.isPending) {
    content = <LoadingState message="Loading categories…" />;
  } else if (query.isError && query.categories.length === 0) {
    content = <ErrorState message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} />;
  } else if (query.categories.length === 0) {
    content = <EmptyState title="No categories yet" message="Create a category first, then add products to it." icon="grid-outline" />;
  } else {
    content = (
      <FlatList
        data={query.categories}
        keyExtractor={(category) => String(category.id)}
        renderItem={({ item }) => (
          <CategoryRow category={item} selected={item.id === selectedId} onPress={() => onSelect(item)} />
        )}
        contentContainerStyle={{ paddingBottom: isTablet ? cardPadding : insets.bottom + spacing.md }}
        testID="category-sheet-list"
      />
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={isTablet ? 'fade' : 'slide'}
      supportedOrientations={[...SUPPORTED_ORIENTATIONS]}
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.backdrop,
          isTablet ? styles.backdropCentered : styles.backdropBottom,
          isTablet && { paddingHorizontal: screenPaddingX, paddingVertical: screenPaddingY },
          { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close" onPress={onClose} />
        <View style={[styles.sheet, isTablet ? styles.sheetDialog : styles.sheetBottom]} testID="category-sheet" accessibilityViewIsModal>
          <View style={[styles.sheetHeader, { paddingHorizontal: cardPadding }]}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Choose a category
            </Text>
            <IconButton icon="close" variant="ghost" accessibilityLabel="Close" onPress={onClose} testID="category-sheet-close" />
          </View>
          <View style={styles.sheetBody}>{content}</View>
        </View>
      </View>
    </Modal>
  );
}

function CategoryRow({ category, selected, onPress }: { category: Category; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={category.name}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, styles.rowDivider, selected && styles.rowSelected, pressed && styles.rowPressed]}
      testID={`category-option-${category.id}`}
    >
      <View style={styles.thumb}>
        <CatalogImage uri={category.image_url} placeholderIcon="grid-outline" accessibilityLabel={category.name} />
      </View>
      <Text style={styles.rowName} numberOfLines={2}>
        {category.name}
      </Text>
      {category.is_active ? null : <Chip label="Inactive" />}
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
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitle: {
    ...typography.heading,
    color: colors.text,
    flexShrink: 1,
  },
  sheetBody: {
    flexShrink: 1,
    minHeight: hitTarget.large * 3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.large,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowDivider: {
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  rowSelected: {
    backgroundColor: colors.selectedRow,
  },
  rowPressed: {
    backgroundColor: colors.surfaceMuted,
  },
  thumb: {
    width: sizes.thumbnail,
  },
  rowName: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
  },
});
