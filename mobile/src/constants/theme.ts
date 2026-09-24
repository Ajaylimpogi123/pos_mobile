/**
 * The app's single theme. Screens and components never hardcode a colour,
 * spacing, radius or font size: add it here first.
 *
 * Light theme only for now. It is tuned for a POS counter: high contrast,
 * large type, and large tap targets.
 */

export const colors = {
  // Surfaces
  background: '#EEF1F5',
  surface: '#FFFFFF',
  surfaceMuted: '#F5F7FA',
  border: '#C9D1DB',
  borderStrong: '#8A96A6',
  overlay: 'rgba(15, 23, 42, 0.55)',

  // Text
  text: '#0F172A',
  textMuted: '#475569',
  textOnPrimary: '#FFFFFF',
  textOnDanger: '#FFFFFF',

  // Brand / actions
  primary: '#1D4ED8',
  primaryPressed: '#1E3A8A',
  secondary: '#E2E8F0',
  secondaryPressed: '#CBD5E1',
  danger: '#B91C1C',
  dangerPressed: '#7F1D1D',
  disabled: '#94A3B8',

  // Feedback
  errorText: '#B91C1C',
  errorBackground: '#FEE2E2',
  errorBorder: '#F87171',
  infoText: '#1E3A8A',
  infoBackground: '#DBEAFE',
  infoBorder: '#60A5FA',

  // Chips
  chipBackground: '#E0E7FF',
  chipText: '#1E3A8A',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSizes = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 30,
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const sizes = {
  /** Minimum tap target (dp). Counter use, possibly gloved. */
  touchTarget: 48,
  /** Button height (dp). */
  buttonHeight: 56,
  /** Text input height (dp). */
  inputHeight: 56,
  /** Width of a centred form card, e.g. the login card. */
  formCardMaxWidth: 520,
  /** Width of a centred content card, e.g. the home placeholder. */
  contentCardMaxWidth: 760,
  /** Width of a modal dialog. */
  dialogMaxWidth: 460,
  /** Minimum width of a standalone action button (Retry, Logout). */
  actionButtonMinWidth: 200,
  borderWidth: 1,
  borderWidthStrong: 2,
} as const;

export const shadows = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;

export const theme = {
  colors,
  spacing,
  radii,
  fontSizes,
  fontWeights,
  sizes,
  shadows,
} as const;

export type Theme = typeof theme;
