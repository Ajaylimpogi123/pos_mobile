import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { CatalogImage } from '@/components/menu/CatalogImage';
import { SectionLabel } from '@/components/shared/FormSection';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { IconName } from '@/components/ui/Icon';
import { colors, radius, spacing, typography } from '@/constants/theme';
import type { ImagePanelState } from '@/hooks/menu/useCatalogForm';

type ImagePickerPanelProps = {
  image: ImagePanelState;
  placeholderIcon: IconName;
  /** e.g. "Product photo". */
  title: string;
  /** The form is saving / deleting: every action is blocked. */
  disabled?: boolean;
};

const WORKING_LABELS = {
  uploading: 'Uploading image…',
  removing: 'Removing image…',
} as const;

/**
 * Photo card for the product / category forms: a 4:3 preview (the picked
 * image, else the saved one, else a placeholder), "Choose photo", "Take
 * photo" and "Remove image". A picked image is uploaded after the record is
 * saved. A camera-permission denial shows a friendly message with an
 * "Open settings" button.
 */
export function ImagePickerPanel({ image, placeholderIcon, title, disabled = false }: ImagePickerPanelProps) {
  const blocked = disabled || image.picking || image.working !== null;
  const overlayLabel = image.working ? WORKING_LABELS[image.working] : image.picking ? 'Preparing image…' : null;

  return (
    <Card style={styles.card} testID="image-panel">
      <SectionLabel>{title}</SectionLabel>

      <View>
        <CatalogImage uri={image.previewUri} placeholderIcon={placeholderIcon} accessibilityLabel={title} testID="image-preview" />
        {overlayLabel ? (
          <View style={styles.overlay} accessibilityRole="progressbar" accessibilityLabel={overlayLabel} testID="image-progress">
            <ActivityIndicator size="large" color={colors.onPrimary} />
            <Text style={styles.overlayText}>{overlayLabel}</Text>
          </View>
        ) : null}
      </View>

      {image.isPending ? (
        <Text style={styles.hint} testID="image-pending-hint">
          New photo selected. It uploads when you save.
        </Text>
      ) : null}

      {image.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error} accessibilityLiveRegion="polite" testID="image-error">
            {image.error}
          </Text>
          {image.showSettingsHint ? (
            <Button
              title="Open settings"
              leftIcon="settings-outline"
              variant="ghost"
              onPress={image.openSettings}
              testID="image-open-settings"
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          title="Choose photo"
          leftIcon="images-outline"
          variant="secondary"
          onPress={() => image.choose('library')}
          disabled={blocked}
          style={styles.action}
          testID="image-choose"
        />
        <Button
          title="Take photo"
          leftIcon="camera-outline"
          variant="secondary"
          onPress={() => image.choose('camera')}
          disabled={blocked}
          style={styles.action}
          testID="image-camera"
        />
      </View>
      {image.canRemove ? (
        <Button
          title={image.isPending ? 'Discard new photo' : 'Remove image'}
          leftIcon="trash-outline"
          variant="ghost"
          onPress={image.remove}
          disabled={blocked}
          testID="image-remove"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  overlayText: {
    ...typography.label,
    color: colors.onPrimary,
  },
  hint: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  errorBox: {
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  error: {
    ...typography.bodySm,
    color: colors.dangerText,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
});
