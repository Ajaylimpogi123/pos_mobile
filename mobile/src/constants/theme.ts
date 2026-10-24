import { Platform, type TextStyle } from 'react-native';

/**
 * The app's single theme: `design-system/pos/MASTER.md` (approved 2026-10-07,
 * clarified 2026-10-13 in §6). It keeps the legacy look: the shadcn "neutral"
 * base, Figtree, white cards on a light inset panel, and brand green for
 * actions, money and the active state. Screens and components never hardcode
 * a colour, spacing, radius, font, font size, shadow or hit-target size: add
 * it here first.
 *
 * Accessibility (WCAG 2.1 AA; every pair is from MASTER §1 and was checked there):
 * - `green` #15803D: white text on it 5.0:1; as text on white 5.0:1.
 * - `text` #252525 on white 15:1. `textSecondary` (`muted-text`) #6B6B6B 5.3:1.
 * - `textMuted` #8E8E8E (3.3:1) is for placeholders and decoration only.
 * - Status text / dot colours are ≥ 4.5:1 on their tint (MASTER §1.3).
 * - The disabled button pair #4B5563 on #E5E7EB is 6.4:1.
 */

/**
 * Status colours (MASTER §1.3): the text / dot colour, the tinted background
 * and the border. `text` equals `color` (every status colour already passes
 * AA on its tint); it stays as its own key for long-form text.
 * - completed: Completed / OK / In stock
 * - pending, caution: Needs review / Low / Pending (one amber family)
 * - cancelled: Voided / Out / Failed / Error
 * - processing: Refunded / Processing / Info
 */
export const status = {
  completed: { color: '#15803D', tint: '#F0FDF4', text: '#15803D', border: '#BBF7D0' },
  pending: { color: '#B45309', tint: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
  processing: { color: '#1D4ED8', tint: '#EFF6FF', text: '#1D4ED8', border: '#BFDBFE' },
  cancelled: { color: '#B91C1C', tint: '#FEF2F2', text: '#B91C1C', border: '#FECACA' },
  /** Warning / low stock: the same amber family as `pending`. */
  caution: { color: '#B45309', tint: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
} as const;

export type StatusKey = keyof typeof status;

export const colors = {
  // Brand green (MASTER §1.2): actions, prices, money totals, the active state.
  green: '#15803D',
  greenHover: '#166534',
  greenSoft: '#F0FDF4',
  /** The 4 px bottom border of the active category tile, hover borders (3.3:1, non-text). */
  greenLine: '#16A34A',
  /** The active category icon circle. */
  greenChip: '#BBF7D0',

  // Legacy names, mapped onto the brand green (kept so existing imports keep working).
  primary: '#15803D',
  primaryPressed: '#166534',
  /** Dark green: text on `primarySoft`, the pressed fill of dark-green controls. */
  primaryDark: '#166534',
  primaryDarkPressed: '#14532D',
  /** Non-text accent: spinners, switch tracks, the focus ring. */
  primaryBright: '#15803D',
  primarySoft: '#F0FDF4',
  primarySoftPressed: '#DCFCE7',
  /** @deprecated alias of `primaryDark`. */
  accentDeep: '#166534',
  /** @deprecated alias of `primaryDarkPressed`. */
  accentDeepPressed: '#14532D',
  onPrimary: '#FFFFFF',

  // Dark neutral (MASTER §1.1 `primary`): "New sale", the active tab.
  dark: '#343434',
  darkPressed: '#252525',
  onDark: '#FAFAFA',

  /** Amber highlight (decoration only, e.g. the login feature icons). Non-text on white. */
  highlight: '#D97706',
  highlightSoft: '#FFFBEB',
  highlightText: '#B45309',

  // Surfaces (MASTER §1.1)
  /** App background behind the sidebar and the inset panel. */
  sidebar: '#FAFAFA',
  /** The inset content panel; every screen paints it. */
  background: '#F7F7F7',
  inset: '#F7F7F7',
  surface: '#FFFFFF',
  /** Summary boxes (the cart totals). */
  subtle: '#F9FAFB',
  /** Hover / pressed background, the active sidebar item, the avatar tile. */
  accent: '#EFEFEF',
  /** The segmented-tab track and quiet fills (search, icon buttons). */
  surfaceMuted: '#F5F5F5',
  surfacePressed: '#EFEFEF',
  /** Image placeholder panel (product / category). */
  imageTint: '#F3F4F6',
  /** Every hairline, input border and table rule. */
  border: '#EBEBEB',
  /** Stronger lines: the inactive category tile's top border, empty PIN dots, checkbox outlines. */
  borderStrong: '#D1D5DB',
  /** Row dividers inside a card. */
  divider: '#EBEBEB',
  /** A table row on hover / the selected row. */
  rowHover: '#FAFAFA',
  selectedRow: '#EFEFEF',
  /** Dialog backdrop. */
  overlay: 'rgba(0, 0, 0, 0.5)',

  // Category tiles (MASTER §3, used by Sell)
  tileInactiveFrom: '#F3F4F6',
  tileInactiveTo: '#F9FAFB',
  /** Product names on product cards. */
  productName: '#374151',
  /** Item counts on category tiles, the disabled button label. */
  textSubtle: '#4B5563',

  // Text
  text: '#252525',
  /** Resting nav items and filter-chip labels. */
  textResting: '#3F3F3F',
  /** `muted-text`: secondary text (5.3:1). */
  textSecondary: '#6B6B6B',
  /** Placeholders and decoration only (3.3:1). */
  textMuted: '#8E8E8E',

  // Disabled buttons (MASTER §3: the reason goes in the label).
  disabled: '#E5E7EB',
  onDisabled: '#4B5563',

  // On the green band / the login brand panel.
  onGradient: '#FFFFFF',
  onGradientMuted: '#DCFCE7',
  /** Translucent white fill on a green / dark surface. */
  onGradientSurface: 'rgba(255, 255, 255, 0.18)',
  /** The feature-row icon tiles on the brand panel. */
  onBrandTile: 'rgba(255, 255, 255, 0.1)',
  /** The version line on the brand panel. */
  onBrandFaint: '#BBF7D0',
  /** The large outline drawn faintly on the brand panel. */
  onBrandDecoration: 'rgba(255, 255, 255, 0.06)',

  // Feedback: mapped onto the status palette.
  /** Destructive text and outline (MASTER §1.4). */
  danger: '#DC2626',
  dangerPressed: '#B91C1C',
  dangerSoft: status.cancelled.tint,
  dangerText: status.cancelled.text,
  /** The outline of the destructive outline button. */
  dangerBorder: '#DC2626',
  /** A filled destructive button (e.g. a confirmed "Void order"). */
  destructiveFill: '#B91C1C',
  destructiveFillPressed: '#991B1B',
  /** = status.caution */
  warning: status.caution.color,
  warningSoft: status.caution.tint,
  warningText: status.caution.text,
  warningBorder: status.caution.border,
  /** = status.processing */
  info: status.processing.color,
  infoSoft: status.processing.tint,
  infoText: status.processing.text,
  infoBorder: status.processing.border,
  /** = status.completed */
  success: status.completed.color,
  successSoft: status.completed.tint,
  successText: status.completed.text,
  successBorder: status.completed.border,
  /** = status.pending */
  pending: status.pending.color,
  pendingSoft: status.pending.tint,
  pendingText: status.pending.text,

  transparent: 'transparent',
} as const;

/**
 * Stat-card accents (MASTER §1.4): figures only, never actions. `color` is the
 * figure, `tint` the 36 px icon square.
 */
export const statAccent = {
  sales: { color: '#15803D', tint: '#F0FDF4' },
  orders: { color: '#2563EB', tint: '#EFF6FF' },
  average: { color: '#9333EA', tint: '#FAF5FF' },
  stock: { color: '#C2410C', tint: '#FFF7ED' },
} as const;

export type StatAccentKey = keyof typeof statAccent;

/** Gradients for `expo-linear-gradient`. */
export const gradients = {
  /** The decorative header band (MASTER §1.2 / §2.3): 135°, #047857 → #6EE7B7 (55 %) → #4ADE80. */
  band: {
    colors: ['#047857', '#6EE7B7', '#4ADE80'] as const,
    locations: [0, 0.55, 1] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  /** The inactive category tile. */
  tileInactive: { colors: [colors.tileInactiveFrom, colors.tileInactiveTo] as const },
  /** The active category tile: white → green-soft. */
  tileActive: { colors: [colors.surface, colors.greenSoft] as const },
} as const;

/** 4-pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

/** Radii (MASTER §1.6): 12 cards and panels, 8 inputs / tiles / outline buttons, 6 badges, 999 pills. */
export const radius = {
  /** Table badges, checkboxes, small tags. */
  sm: 6,
  /** The selected segment inside a segmented track. */
  inner: 6,
  /** Inputs, tiles, outline / dark buttons, nav items, rows. */
  md: 8,
  /** PIN keys and keypad keys (tiles). */
  cta: 8,
  /** Cards, the inset panel, summary boxes. */
  lg: 12,
  /** Dialogs and sheets. */
  xl: 16,
  /** The rounded bottom corners of the stacked login header. */
  header: 28,
  /** The decorative header band. */
  band: 6,
  /** Primary pill buttons ("+ Add", Checkout) and steppers. */
  pill: 999,
} as const;

/**
 * Figtree faces, by weight. Custom families carry their weight in the family
 * name (Android ignores `fontWeight` for them), so typography roles set
 * `fontFamily` only. Loaded in `app/_layout.tsx`.
 */
export const fontFamilies = {
  regular: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
  heavy: 'Figtree_800ExtraBold',
} as const;

/** Weight → font family (use instead of `fontWeight`). */
export const fontWeights = fontFamilies;

/** Tabular digits, so prices and totals line up and don't jitter while they change. */
const tabular: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

/** Type scale (MASTER §1.5). Minimum size is 12. */
export const typography = {
  /** Display · 800. */
  display: { fontSize: 32, lineHeight: 38, fontFamily: fontFamilies.heavy, letterSpacing: -0.64 },
  /** Title · 700. */
  title: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold, letterSpacing: -0.2 },
  /** The login card title (tablets). */
  titleLarge: { fontSize: 26, lineHeight: 32, fontFamily: fontFamilies.bold, letterSpacing: -0.26 },
  /** Card title · 700. */
  heading: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold },
  /** Header page title (MASTER §2.1: 16 / 500): phones and short landscape heights. */
  barTitle: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.medium },
  /** Header page title: tablets (the same 16 / 500). */
  barTitleLarge: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.medium },
  /** Page title on the band (white, 26 / 700). */
  bandTitle: { fontSize: 26, lineHeight: 32, fontFamily: fontFamilies.bold, letterSpacing: -0.26 },
  /** The band title on short heights. */
  bandTitleCompact: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold },
  /** Subtitle on the band (white, at least 14 / 600). */
  bandSubtitle: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  /** Section heading inside content. */
  section: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.semibold },
  /** Body · 16 / 400 (tablet). */
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamilies.regular },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fontFamilies.semibold },
  /** Secondary · 14 / 400. */
  bodySm: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.regular },
  /** Field labels, small strong text. */
  label: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  /** Buttons · 15 / 600. */
  button: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.semibold },
  /** The large CTA (Sign in, Checkout) · 16 / 600. */
  buttonLarge: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.semibold },
  /** Filter chips, segmented options, outline buttons · 14 / 500. */
  control: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.medium },
  controlStrong: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  /** Caption · 13 / 400. */
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.regular },
  captionStrong: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.semibold },
  /** Badge words (MASTER §3: 12 / 600). */
  chip: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.semibold },
  /** Group labels (sidebar). */
  overline: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.medium },
  /** Sidebar items. */
  navItem: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.medium },
  navItemActive: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  /** A category tile name (MASTER §3: 15 / 500). */
  tileName: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.medium },
  /** A product card name and price (MASTER §3: 16 / 700). */
  productName: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.bold },
  productPrice: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.bold, ...tabular },
  /** The Current Order title (MASTER §3: 20 / 700). */
  orderTitle: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold },
  /** Price · 700, shown in green. */
  price: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold, ...tabular },
  /** Total · 700: a sale's total (cart footer, checkout). */
  total: { fontSize: 28, lineHeight: 34, fontFamily: fontFamilies.bold, letterSpacing: -0.28, ...tabular },
  /** The one number that must be read across the counter: the change due. */
  hero: { fontSize: 44, lineHeight: 52, fontFamily: fontFamilies.heavy, letterSpacing: -0.88, ...tabular },
  /** Digits on the PIN pad. */
  pinKey: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.semibold, ...tabular },
  /** The login brand panel headline (tablet landscape). */
  brandHeadline: { fontSize: 40, lineHeight: 46, fontFamily: fontFamilies.heavy, letterSpacing: -0.8 },
  /** The stacked login header headline (phones, tablet portrait). */
  brandHeadlineCompact: { fontSize: 28, lineHeight: 33, fontFamily: fontFamilies.heavy, letterSpacing: -0.56 },
  /** The sidebar brand title. */
  brandSmall: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.bold, letterSpacing: -0.15 },
  /** Small medium-weight caption (the sidebar branch / role line). */
  captionMedium: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.medium },
  /** Stat-card values · 26 / 700. */
  kpiValue: { fontSize: 26, lineHeight: 32, fontFamily: fontFamilies.bold, letterSpacing: -0.26, ...tabular },
  /** Values on total / summary cards · 700. */
  metricValue: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.bold, ...tabular },
  /** Table column headers: 13 / 500 in `muted-text` (not uppercase). */
  tableHeader: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.medium },
  /** Table cells: 14 regular. */
  tableCell: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.regular },
  /** The title of a detail pane / settings pane · 700. */
  paneTitle: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold, letterSpacing: -0.18 },
  /** The brand name beside the logo tile. */
  brandName: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold },
  /** Brand tagline on the dark panel. */
  brandTagline: { fontSize: 16, lineHeight: 25, fontFamily: fontFamilies.regular },
  /** Phase 8 Error log: stack traces and raw context (the platform monospace face). */
  mono: { fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
} as const;

/** Tabular digits for any numeric text that doesn't use a numeric role. */
export const numeric = tabular;

/**
 * Shadows (MASTER §1.6), using React Native's cross-platform `boxShadow`
 * style (New Architecture; Android 9+). Nothing is heavier than `tile`.
 */
const CARD_SHADOW = '0px 1px 2px rgba(0, 0, 0, 0.05)';
const INSET_SHADOW = '0px 1px 3px rgba(0, 0, 0, 0.08)';
const TILE_SHADOW = '0px 4px 8px rgba(0, 0, 0, 0.08)';

export const shadows = {
  none: { boxShadow: 'none' },
  /** Cards. */
  sm: { boxShadow: CARD_SHADOW },
  md: { boxShadow: CARD_SHADOW },
  /** Dialogs, sheets, popovers: the heaviest allowed. */
  lg: { boxShadow: TILE_SHADOW },
  /** The inset content panel. */
  inset: { boxShadow: INSET_SHADOW },
  /** The active category tile. */
  tile: { boxShadow: TILE_SHADOW },
  /** @deprecated primary buttons no longer glow. */
  primary: { boxShadow: 'none' },
  /** The selected segment of a segmented control. */
  segment: { boxShadow: CARD_SHADOW },
  /** Focus ring (MASTER §1.1): 2 px green with a 2 px white offset. */
  focusRing: { boxShadow: `0px 0px 0px 2px ${colors.surface}, 0px 0px 0px 4px ${colors.green}` },
  /** Under the top bar: none (flat, with a hairline bottom border). */
  bar: { boxShadow: 'none' },
  /** The floating phone cart bar. */
  dark: { boxShadow: TILE_SHADOW },
} as const;

/** Minimum touch targets (dp). */
export const hitTarget = {
  /** Any pressable: at least 44×44 (grown with hitSlop where the visual is smaller). */
  min: 44,
  /** Primary actions on the tablet: 48. */
  primary: 48,
  /** Large primary actions (tablet Checkout, Sign in): 52. */
  large: 52,
} as const;

export const iconSizes = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const sizes = {
  borderWidth: 1,
  borderWidthFocus: 2,
  /** Text input height. */
  inputHeight: 48,
  /** Round icon buttons: `md` is the 44 minimum (hitSlop grows it to 48), `lg` is 48. */
  iconButton: { md: hitTarget.min, lg: hitTarget.primary },
  /** The decorative round "+" on a product tile (the whole tile is the button). */
  addBadge: 32,
  /** Header height, without the safe area (MASTER §6: 48 on tablets, 56 on phones). */
  topBar: { phone: 56, tablet: 48 },
  /** Header status badges: the visual height; hitSlop grows the touch area. */
  statusChipHeight: 28,
  /** The vertical separator in the header (after the menu / back button). */
  headerSeparator: 20,
  /** Round brand mark on the login screen (legacy sizes). */
  brandMark: { compact: 44, regular: 64, large: 88 },
  /** The logo tile on the login brand panel. */
  brandTile: 48,
  /** The feature-row icon tiles on the brand panel. */
  brandFeatureTile: 32,
  /** The faint outline on the brand panel (side panel / stacked header). */
  brandLeaf: { side: 520, header: 300 },
  /** Minimum height of the stacked login header (phones, tablet portrait). */
  loginHeader: { phone: 300, tablet: 340 },
  /** Width of the login form card (tablets). */
  loginCardWidth: 420,
  /** Round icon badge at the top of a card / dialog / state. */
  badge: { md: 40, lg: 64 },
  /** Badges and tags (MASTER §3 / §6): 24 high; their text stays ≥ 12. */
  chipMinHeight: 24,
  /** The dot inside a status badge. */
  chipDot: 6,
  /** Segmented control track height. */
  segmentedHeight: 48,
  /** Product / category images keep this width:height ratio. */
  cardImageAspectRatio: 4 / 3,
  /** Square thumbnail, e.g. a category row in the picker sheet. */
  thumbnail: 48,
  /** Inventory: the product image beside an inventory card's text. */
  inventoryThumb: 72,
  /** PIN pad: key height (large, for counter use) and the entered-digit dots. */
  pinKey: 56,
  pinDot: 12,
  /** Width of the qty value between a stepper's − and + buttons. */
  stepperValue: 40,
  /** Stepper − / + buttons (hitSlop keeps the touch area at 48). */
  stepperButton: 44,
  /** A status dot (printer reachability, status badges). */
  statusDot: 6,
  /** The ✓ box of a multi-select row (e.g. a printer's categories). */
  checkbox: 24,
  /** The grab handle on top of a bottom sheet. */
  sheetHandle: { width: 40, height: 4 },
  /** Loading skeleton blocks. */
  skeleton: { line: 12, lineLarge: 18, row: 72, tile: 120 },
  /** DataTable: the default fixed row height, and the 40 px header row. */
  tableRow: 52,
  tableHeader: 40,
  /** The bar on the left edge of a selected table / settings row. */
  selectedBar: 3,
  /** The extra-large CTA (Checkout, Complete sale): the tablet Checkout pill. */
  cta: 52,
  /** Cash keypad keys (checkout). */
  keypadKey: 64,
  /** Payment method tiles (checkout). */
  methodTile: 84,
  /** The image panel of a Sell product tile. */
  tileImage: { phone: 72, tablet: 96 },
  /** The full-width "+ Add" pill on a product card (MASTER §3: 40, the card action height). */
  tileAddButton: 40,
  /** The icon circle on a category tile (MASTER §3: 40). */
  categoryIcon: 40,
  /** The 4 px border on a category tile (top: inactive, bottom: active). */
  categoryTileBorder: 4,
  /** A cart line's thumbnail (sell.md: 44). */
  cartThumb: 44,
  /** The floating phone cart bar. */
  cartBar: 64,
  /** The coloured bar on a summary card (inventory / purchasing summaries). */
  summaryBar: { phone: 4, tablet: 10 },
  /** The row of a `ListRow` (settings nav, menu rows). */
  listRow: 56,
  /** Compact choice chips / segmented controls in card headers. */
  chipCompact: 40,
  segmentedCompact: 36,
  /** The decorative header band (MASTER §2.3 / §6): 200 on tablets, 120 below 600 px of height. */
  band: { regular: 200, short: 120 },
  /** Toasts: the icon column. */
  toastIcon: 20,
  /** A stat card's icon square (MASTER §3: 36). */
  statIcon: 36,
} as const;

/** Printer reachability colours (a dot beside a text label: the colour is never the only cue). */
export const printerStatus = {
  ok: colors.success,
  down: colors.danger,
  checking: colors.warning,
  unknown: colors.textMuted,
} as const;

/** Layout constants used by `useResponsive`. */
export const layout = {
  /** Width below which a phone counts as small. */
  smallPhoneMaxWidth: 380,
  /** Phase 8 Error log: max height of a stack trace's scroll box before it scrolls. */
  stackMaxHeight: 320,
  /** Shortest side at or above which the device counts as a tablet. */
  tabletMinShortSide: 600,
  /** Height below which the layout is "compact" (short landscape). */
  compactMaxHeight: 480,
  /** Height below which the header band shrinks to its short size (MASTER §6). */
  bandShortMaxHeight: 600,
  /** The band's text block is capped at this share of its width, so white text stays on the dark side. */
  bandTextMaxShare: 0.5,
  /** Max width of the login card and small centred forms. */
  formMaxWidth: 480,
  /** Max width of a back-office create / edit form card (back-office.md). */
  backOfficeFormMaxWidth: 720,
  /** Max width of page content (card grids, top-bar content). */
  contentMaxWidth: 1200,
  /** Max width of a modal dialog. */
  dialogMaxWidth: 440,
  /** Max width of a two-pane form (a side card beside the fields, tablet landscape). */
  formWideMaxWidth: 960,
  /** Share of a two-pane form's width taken by the side card (image panel, security card). */
  asidePaneFlex: 2,
  /** Share of a two-pane form's width taken by the fields. */
  mainPaneFlex: 3,
  /** Max width of the search box when it shares a row with other filters. */
  searchMaxWidth: 420,
  /** Max width of a segmented control. */
  segmentedMaxWidth: 420,
  /** Dashboard period filter (v1.28): the Day · Month · Year control's preferred width before it wraps. */
  periodSegmentBasis: 240,
  /** Dashboard period filter: the stepper's label keeps this width so ‹ › don't jump as the label changes. */
  periodLabelMinWidth: 136,
  /** Max height of a bottom sheet, as a share of the window height. */
  sheetMaxHeight: '80%',
  /** Share of the width the login brand panel takes in tablet landscape (≈ 44%). */
  brandPanelFlex: 44,
  /** Share of the width the login form pane takes in tablet landscape. */
  formPaneFlex: 56,
  /** Max width of the brand panel's tagline. */
  brandTaglineMaxWidth: 400,
  /** A dashboard card's title keeps at least this width before its table toggle wraps below it. */
  sectionTitleMinWidth: 120,
  /** The top-bar title keeps at least this width before the right-hand actions shrink or scroll. */
  barTitleMinWidth: 48,
  /** Sell screen: a category tab tile's width (MASTER §3: 112 on tablet). */
  categoryTileWidth: 112,
  /** Sell screen: width of the permanently visible Current Order card (tablet landscape, sell.md: 360). */
  cartPanelWidth: 360,
  /** Sell screen, tablet portrait: the menu and the always-visible cart below it share the height (3 : 2). */
  portraitMenuFlex: 3,
  portraitCartFlex: 2,
  /** Sell screen: product tiles never get narrower than this; fewer columns are used instead. */
  sellTileMinWidth: 150,
  /** Max height of the cart sheet (phones and portrait), as a share of the window height. */
  cartSheetMaxHeight: '90%',
  /** Max width of a receipt-style view (order detail, sale complete). */
  receiptMaxWidth: 640,
  /** Max width of the PIN pad. */
  pinPadMaxWidth: 320,
  /** Reports (Phase 6): the width of each numeric column of the rows table (wide layouts). */
  reportNumberColumnWidth: 96,
  /** Reports: the narrower count columns (orders, quantity). */
  reportCountColumnWidth: 64,
  /** Reports: the day chart draws up to this many days; longer ranges use the table. */
  reportChartMaxDays: 31,
  /** Inventory report: the compact quantity columns (opening, received, … closing). */
  inventoryQtyColumnWidth: 56,
  /** Inventory report: the status column (a chip, with the reorder level under it). */
  inventoryStatusColumnWidth: 84,
  /** Height reserved for a future bottom tab bar (none yet). */
  tabBarHeight: 0,
  /** Ingredients: a units-editor row's name field keeps this width before the factor wraps under it. */
  unitNameMinWidth: 140,
  /** Ingredients: the units-editor row's factor field. */
  unitFactorMinWidth: 160,
  /** Purchasing: a PR item / PO line / receive line field keeps this width before wrapping. */
  purchaseFieldMinWidth: 200,
  /** Purchasing report: the wider text columns (item, supplier). */
  reportTextColumnWidth: 140,
  /** A timeline row's dot column. */
  timelineDotSize: 12,
  /** The inline search in a list's top bar (tablets): its width, and how far it may shrink. */
  headerSearchWidth: 280,
  headerSearchMinWidth: 160,
  /** Settings: width of the section list beside the pane (wide layouts). */
  settingsNavWidth: 300,
  /** DataTable: the row-actions (⋯) column. */
  rowActionsWidth: 48,
  /** Toasts: max width (tablets), centred at the top. */
  toastMaxWidth: 480,
} as const;

export const opacity = {
  disabled: 0.5,
  /** Dimmed content, e.g. the image of an unavailable product. */
  dimmed: 0.55,
  /** Immediate press feedback on quiet (unfilled) pressables. */
  pressed: 0.7,
  /** Loading skeleton pulse: low and high opacity. */
  skeletonLow: 0.45,
  skeletonHigh: 1,
} as const;

/** Animation durations (ms). MASTER §1.7: 150–200 ms ease-out; none under reduce-motion. */
export const motion = {
  /** Cross-fade when a remote image finishes loading. */
  imageFadeMs: 150,
  /** Slide-in drawer / overlay sidebar, and its scrim fade. */
  drawerMs: 200,
  /** One half of a loading skeleton's pulse (native driver). */
  skeletonPulseMs: 700,
  /** Toast fade in / out. */
  toastMs: 150,
  /** How long a toast stays up. */
  toastVisibleMs: 3000,
  /** A product card's "Added ✓" feedback (sell.md: brief). */
  addedMs: 1000,
  /** The highlight on the cart line a tap just added to (sell.md: 600 ms). */
  lineHighlightMs: 600,
} as const;

/**
 * App-shell sidebar (`src/components/shell`, MASTER §2.1 / §2.2 / §6): a 64 dp
 * icon rail on the `sidebar` background (logo, a dark icon-only New sale
 * button, the module icons, the user tile), and the 256 dp labelled panel as
 * an overlay. The active item is the `accent` fill with `text`-coloured
 * label and icon; resting items are quiet rows.
 */
export const sidebar = {
  /** The labelled panel (overlay / drawer). */
  widthExpanded: 256,
  /** The icon rail. */
  widthRail: 64,
  /** Slide-in drawer / overlay panel: at most this wide… */
  drawerMaxWidth: 256,
  /** …and at most this share of the window width (a strip of scrim stays tappable). */
  drawerMaxShare: 0.86,
  /** Rounded outer (right) corners of the slide-in drawer / overlay panel. */
  panelRadius: radius.lg,
  /** Inner padding of the panel. */
  panelPadding: spacing.md,
  /** Inner padding of the rail: (64 − 48) / 2. */
  railPadding: spacing.sm,
  /** The margin around the inset content panel (MASTER §2.1). */
  insetMargin: spacing.sm,
  /** Gap between the persistent rail and the screen edges (flush). */
  outerMargin: 0,
  /** Height of the brand block on top. */
  brandHeight: 56,
  /** Expanded nav item height: at least the 44 touch target. */
  itemHeight: 44,
  /** Rail nav item: a rounded square button. */
  railItemSize: 48,
  /** The round logo: 64 in the panel, 40 in the rail. */
  logoSize: 64,
  logoSizeCompact: 40,
  /** The small round collapse chevron: drawn at 32, touch area grown to 44 with hitSlop. */
  chevronSize: 32,
  chevronHitSlop: 6,
  /** Round initials avatar in the footer. */
  avatarSize: 36,
  colors: {
    panel: colors.sidebar,
    border: colors.border,
    text: colors.text,
    textMuted: colors.textSecondary,
    groupLabel: colors.textSecondary,
    itemText: colors.textResting,
    item: colors.transparent,
    itemPressed: colors.accent,
    /** The active item: the `accent` fill with `text` label and icon. */
    active: colors.accent,
    activePressed: colors.borderStrong,
    activeText: colors.text,
    activeIcon: colors.text,
    chevron: colors.accent,
    chevronPressed: colors.borderStrong,
    soonTag: colors.accent,
    soonText: colors.textSecondary,
    divider: colors.border,
    avatar: colors.accent,
    avatarText: colors.text,
    /** Footer actions (Log out): quiet rows. */
    footerAction: colors.transparent,
    footerActionPressed: colors.accent,
    scrim: colors.overlay,
  },
} as const;

/**
 * Charts (`src/components/charts`), drawn with react-native-svg.
 *
 * `series` follows MASTER §1.4: green, blue, amber, assigned in this fixed
 * order and never cycled. A 4th series colour needs re-validation; anything
 * past the third series folds into "Other". Every chart carries direct
 * labels or legend values, and a table view. Text never wears a series
 * colour: labels use the text tokens.
 */
export const chart = {
  series: ['#15803D', '#2563EB', '#D97706'] as readonly string[],
  /** Extra categories folded into "Other" (never a generated hue). */
  other: '#A3A3A3',
  /** Area fills use the series colour at this opacity. */
  areaOpacity: 0.18,
  /** Recessive hairline gridlines. */
  grid: colors.divider,
  /** Baseline / axis line. */
  axis: colors.borderStrong,
  /** Axis tick labels and the reference-line label. */
  axisLabel: colors.textSecondary,
  /** The card surface the marks sit on (gaps and marker rings use it). */
  surface: colors.surface,
  /** Bar thickness (thin: never fills its row). */
  barThickness: 16,
  /** Rounded data-end of bars (square at the baseline). */
  barRadius: 4,
  /** Surface gap between stacked segments, adjacent bars and donut slices. */
  gap: 2,
  lineWidth: 2,
  /** Line markers: 8px diameter, with a 2px surface ring. */
  markerRadius: 4,
  markerRing: 2,
  /** The selected day's markers grow a little. */
  markerRadiusActive: 6,
  gridWidth: 1,
  /** Dash pattern of reference lines. */
  referenceDash: '4 4',
  /** The reference-line label row (e.g. "30% target") above horizontal bars. */
  referenceLabelHeight: 20,
  referenceLabelWidth: 80,
  /** Line charts: an x label's minimum width; denser columns skip labels (the tooltip still names each one). */
  xLabelMinWidth: 32,
  /** Rows of horizontal bar charts: at least the 44 touch target. */
  rowMinHeight: 44,
  /** Share of a horizontal bar chart's width taken by the category labels. */
  labelShare: 0.36,
  /** Room kept after the longest bar for its end label. */
  valueLabelReserve: 64,
  /** The same room for money end labels (e.g. "₱12,345.00"). */
  moneyLabelReserve: 96,
  /** Gap between a bar's end and its value label. */
  valueLabelGap: 6,
  /** Line chart plot height (without the x-axis labels). */
  plotHeight: 160,
  /** Width of the y-axis tick labels. */
  yAxisWidth: 32,
  /** Height of the x-axis label row. */
  xAxisHeight: 24,
  /** Donut: outer diameter cap and ring thickness. */
  donutMaxSize: 176,
  donutThickness: 26,
  /** Legend swatch (a small rounded square beside the text). */
  swatchSize: 12,
  tooltipMaxWidth: 240,
} as const;

/** Pressed feedback: a subtle shrink (MASTER §1.7: 0.98). Dropped under reduce-motion. */
export const pressedScale = 0.98;

export const theme = {
  colors,
  status,
  statAccent,
  gradients,
  spacing,
  radius,
  fontFamilies,
  fontWeights,
  typography,
  numeric,
  shadows,
  hitTarget,
  iconSizes,
  sizes,
  layout,
  opacity,
  motion,
  sidebar,
  chart,
  printerStatus,
  pressedScale,
} as const;

export type Theme = typeof theme;
