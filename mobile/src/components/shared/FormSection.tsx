import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/ui/Card';
import { colors, spacing, typography } from '@/constants/theme';

type SectionLabelProps = {
  children: string;
  testID?: string;
};

/** The uppercase 12/700 group label of the Foundations board ("DETAILS", "PRICING"). Announced as a header. */
export function SectionLabel({ children, testID }: SectionLabelProps) {
  return (
    <Text style={styles.label} accessibilityRole="header" numberOfLines={2} testID={testID}>
      {children}
    </Text>
  );
}

type FormSectionProps = {
  title: string;
  /** A muted line under the label (what the section is for). */
  description?: string;
  /** Beside the label on the right, e.g. a status chip. */
  accessory?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * One group of a form or detail screen: a flat white card (radius 16,
 * hairline border) with an uppercase section label, an optional muted
 * description and the fields below it.
 */
export function FormSection({ title, description, accessory, children, style, testID }: FormSectionProps) {
  return (
    <Card style={[styles.card, style]} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <SectionLabel>{title}</SectionLabel>
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        {accessory}
      </View>
      {children}
    </Card>
  );
}

/** A hairline between the rows of a section (switch rows, settings rows). */
export function SectionDivider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    ...typography.overline,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
  description: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});
