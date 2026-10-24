import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ListHeader } from '@/components/shared/ListHeader';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { ROUTES } from '@/constants/routes';
import { layout } from '@/constants/theme';

export type MenuSection = 'products' | 'categories';

const SECTIONS: readonly SegmentOption<MenuSection>[] = [
  { value: 'products', label: 'Products', icon: 'fast-food-outline', testID: 'menu-tab-products' },
  { value: 'categories', label: 'Categories', icon: 'grid-outline', testID: 'menu-tab-categories' },
];

const SECTION_ROUTES = {
  products: ROUTES.menuProducts,
  categories: ROUTES.menuCategories,
} as const;

type MenuHeaderProps = {
  section: MenuSection;
  /** Accessible label of the "+" button, e.g. "New product". */
  newLabel: string;
  onNew: () => void;
};

/**
 * Top bar for the menu admin lists: back (to home), title, a round
 * "+" button, and a Products / Categories segmented control just below the bar. Switching
 * replaces the route, so Back always returns home rather than to the other tab.
 */
export function MenuHeader({ section, newLabel, onNew }: MenuHeaderProps) {
  return (
    <ListHeader band title={section === 'products' ? 'Products' : 'Categories'} newLabel={newLabel} onNew={onNew} testIDPrefix="menu">
      <SegmentedControl
        options={SECTIONS}
        value={section}
        accessibilityLabel="Menu section"
        onChange={(next) => router.replace(SECTION_ROUTES[next])}
        style={styles.tabs}
        testID="menu-tabs"
      />
    </ListHeader>
  );
}

const styles = StyleSheet.create({
  tabs: {
    width: '100%',
    maxWidth: layout.segmentedMaxWidth,
  },
});
