import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/Icon';
import { colors, iconSizes, motion, opacity, radius, sizes } from '@/constants/theme';

type CatalogImageProps = {
  /** Absolute `image_url` from the API, or a local `file://` preview. `null` shows the placeholder. */
  uri: string | null;
  /** Placeholder glyph when there is no image (or it fails to load). */
  placeholderIcon: IconName;
  accessibilityLabel: string;
  /** Recycled list cells pass the record id, so a reused cell never flashes the previous image. */
  recyclingKey?: string;
  /** Dim the image (e.g. an unavailable product). */
  dimmed?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A 4:3 rounded image for products and categories, via expo-image with
 * memory + disk caching. Falls back to a soft green placeholder icon when
 * there is no image or it fails to load. The frame is a soft tinted panel.
 */
export function CatalogImage({
  uri,
  placeholderIcon,
  accessibilityLabel,
  recyclingKey,
  dimmed = false,
  style,
  testID,
}: CatalogImageProps) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showImage = uri !== null && uri !== failedUri;

  return (
    <View style={[styles.frame, dimmed && styles.dimmed, style]} testID={testID}>
      {showImage ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={motion.imageFadeMs}
          recyclingKey={recyclingKey}
          accessibilityLabel={accessibilityLabel}
          onError={() => setFailedUri(uri)}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <View style={styles.placeholder} testID={testID ? `${testID}-placeholder` : undefined}>
          <Icon name={placeholderIcon} size={iconSizes.xxl} color={colors.primaryBright} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: sizes.cardImageAspectRatio,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.imageTint,
  },
  dimmed: {
    opacity: opacity.dimmed,
  },
  image: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
