import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';

export const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

type ScreenProps = {
  children: ReactNode;
  /**
   * Safe-area edges this container pads. Defaults to all four, because
   * notches sit left or right in landscape. A screen that draws its own
   * edge-to-edge band (e.g. the top bar) passes fewer edges and pads
   * the rest itself, so that every edge is still covered.
   */
  edges?: readonly Edge[];
  /** Status bar icon colour: `dark` on the off-white background, `light` on a gradient. */
  statusBar?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** Root container for every screen: safe-area aware, themed background, status bar style. */
export function Screen({ children, edges = ALL_EDGES, statusBar = 'dark', style, testID }: ScreenProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, style]} testID={testID}>
      <StatusBar style={statusBar} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
