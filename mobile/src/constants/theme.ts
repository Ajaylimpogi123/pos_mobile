import type { TextStyle } from 'react-native';

/**
 * The app's single theme ("Sage Emerald"). Screens and components never
 * hardcode a colour, spacing, radius, font, font size, shadow or hit-target
 * size: add it here first.
 *
 * Style: calm, clean and fast to read at the counter. A soft sage off-white
 * background, white cards (radius 16) with a hairline border and at most a
 * very soft shadow, a deep emerald primary, soft-green tonal fills and a
 * warm highlight used sparingly. Headers are flat white top bars with a
 * hairline bottom border. Type is Plus Jakarta Sans (loaded in `app/_layout.tsx`).
 *
 * Accessibility notes (WCAG 2.1 AA), measured against white (#FFFFFF) and the
 * background (#F6F8F5):
 * - `primary` #2F7D5A: white text on it 5.16:1; as text on white 5.16:1.
 * - `primaryDark` #205A42: white text 8.4:1; as text on `primarySoft` 7.6:1.
 * - `text` #18231E: 16:1. `textSecondary` #66736C: 4.9:1 on white, 4.6:1 on the background.
 * - `textMuted` #8A968F (3.1:1) is for placeholders and decoration only;
 *   captions use `textSecondary`.
 * - Status chips use the exact status colour for the dot and the label, as
 *   approved in the design (bold 13 on the tint). Long-form status text
 *   (banners, error lines) uses the darker `*Text` shades, which pass AA.
 */

/** Status colours: the dot / label colour, the soft tint behind it, and an AA text shade. */
export const status = {
  completed: { color: '#238B5A', tint: '#E6F4EC', text: '#1B6B45' },
  pending: { color: '#D97745', tint: '#FBEEE6', text: '#96461F' },
  processing: { color: '#3978A8', tint: '#E7EFF6', text: '#2A5A80' },
  cancelled: { color: '#C94C4C', tint: '#F8E6E6', text: '#9E3434' },
  /** Warning / low stock. */
  caution: { color: '#C49A32', tint: '#F8F0DA', text: '#6B521A' },
} as const;

export type StatusKey = keyof typeof status;

export const colors = {
  // Brand / actions
  primary: '#2F7D5A',
  primaryPressed: '#276B4D',
  /** The deep emerald: the login brand panel, text on soft green, round "+" buttons. */
  primaryDark: '#205A42',
  primaryDarkPressed: '#184633',
  /** Non-text accent: focus rings, spinners, switch tracks. */
  primaryBright: '#2F7D5A',
  primarySoft: '#E8F3ED',
  primarySoftPressed: '#D3E8DC',
  /** Sage accent (charts, decoration). Non-text. */
  accent: '#7BAE8C',
  /** Warm highlight (feature icons on the brand panel, "Best seller" tags). Non-text on white. */
  highlight: '#D9B86C',
  highlightSoft: '#F7EFDC',
  highlightText: '#6B521A',
  /** @deprecated alias of `primaryDark` (kept so existing imports keep working). */
  accentDeep: '#205A42',
  /** @deprecated alias of `primaryDarkPressed`. */
  accentDeepPressed: '#184633',
  onPrimary: '#FFFFFF',

  // Surfaces
  background: '#F6F8F5',
  surface: '#FFFFFF',
  /** Soft grey-green fill: the pill search, segmented track, top-bar icon buttons. */
  surfaceMuted: '#F1F4F1',
  surfacePressed: '#E6ECE7',
  /** Tinted rounded panel behind product / category images. */
  imageTint: '#F1F6F2',
  /** Hairline borders (cards, inputs, the top bar). */
  border: '#E1E8E3',
  /** Stronger lines: empty PIN dots, the checkbox outline, the sheet handle. */
  borderStrong: '#C9D6CE',
  /** Row dividers inside a card. */
  divider: '#EEF2EF',
  /** The selected row of a table or the settings list (with a 3 dp primary bar on its left edge). */
  selectedRow: '#F3F9F5',
  overlay: 'rgba(24, 35, 30, 0.45)',

  // Text
  text: '#18231E',
  /** Resting nav items and filter-chip labels: between `text` and `textSecondary`. */
  textResting: '#3C4842',
  textSecondary: '#66736C',
  textMuted: '#8A968F',

  // On the dark brand panel (login). Names kept from the former gradient panel.
  onGradient: '#FFFFFF',
  onGradientMuted: '#CFE3D7',
  /** Translucent white fill on a green / dark surface (e.g. a count on a selected rail item). */
  onGradientSurface: 'rgba(255, 255, 255, 0.18)',
  /** The feature-row icon tiles on the brand panel. */
  onBrandTile: 'rgba(255, 255, 255, 0.1)',
  /** The version line on the brand panel. */
  onBrandFaint: '#A9C9B6',
  /** The large leaf outline drawn faintly on the brand panel. */
  onBrandDecoration: 'rgba(255, 255, 255, 0.06)',

  // Feedback: mapped onto the status palette.
  /** = status.cancelled */
  danger: status.cancelled.color,
  dangerPressed: '#A93E3E',
  dangerSoft: status.cancelled.tint,
  dangerText: status.cancelled.text,
  /** The outline of the danger button. */
  dangerBorder: '#EBC7C7',
  /** = status.caution */
  warning: status.caution.color,
  warningSoft: status.caution.tint,
  warningText: status.caution.text,
  /** = status.processing */
  info: status.processing.color,
  infoSoft: status.processing.tint,
  infoText: status.processing.text,
  /** = status.completed */
  success: status.completed.color,
  successSoft: status.completed.tint,
  successText: status.completed.text,
  /** = status.pending */
  pending: status.pending.color,
  pendingSoft: status.pending.tint,
  pendingText: status.pending.text,

  transparent: 'transparent',
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

/** Radii: 12 controls, 16 cards, 20 sheets and dialogs, 999 pills. */
export const radius = {
  /** Small pieces (checkbox, tags inside rows). */
  sm: 8,
  /** The selected segment inside a segmented track, stepper buttons. */
  inner: 10,
  /** Controls: buttons, inputs, nav items, rows. */
  md: 12,
  /** Large actions (the Charge / Sign in button) and PIN keys. */
  cta: 14,
  /** Cards. */
  lg: 16,
  /** Sheets, dialogs, the login card. */
  xl: 20,
  /** The rounded bottom corners of the stacked login header. */
  header: 28,
  pill: 999,
} as const;

/**
 * Plus Jakarta Sans faces, by weight. Custom families carry their weight in
 * the family name (Android ignores `fontWeight` for them), so typography
 * roles set `fontFamily` only.
 */
export const fontFamilies = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  heavy: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Weight → font family (use instead of `fontWeight`). */
export const fontWeights = fontFamilies;

/** Tabular digits, so prices and totals line up and don't jitter while they change. */
const tabular: Pick<TextStyle, 'fontVariant'> = { fontVariant: ['tabular-nums'] };

/** Type scale (Foundations board). Minimum size is 12. */
export const typography = {
  /** Display · 800. */
  display: { fontSize: 34, lineHeight: 40, fontFamily: fontFamilies.heavy, letterSpacing: -0.68 },
  /** Title · 700. */
  title: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.bold, letterSpacing: -0.22 },
  /** The login card title (tablets). */
  titleLarge: { fontSize: 26, lineHeight: 32, fontFamily: fontFamilies.bold, letterSpacing: -0.26 },
  /** Heading · 700. */
  heading: { fontSize: 17, lineHeight: 22, fontFamily: fontFamilies.bold },
  /** Top-bar title: phones and short landscape heights. */
  barTitle: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold, letterSpacing: -0.2 },
  /** Top-bar title: tablets. */
  barTitleLarge: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.bold, letterSpacing: -0.22 },
  /** Section heading inside content ("Fresh items ··· See all"). */
  section: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.bold },
  /** Body · 500. */
  body: { fontSize: 15, lineHeight: 22, fontFamily: fontFamilies.medium },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fontFamilies.semibold },
  bodySm: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.regular },
  /** Field labels, small strong text. */
  label: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.semibold },
  button: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.bold },
  /** The large CTA (Sign in, Charge). */
  buttonLarge: { fontSize: 16, lineHeight: 22, fontFamily: fontFamilies.bold },
  /** Filter chips and segmented options. */
  control: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.semibold },
  controlStrong: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.bold },
  /** Caption · 400. */
  caption: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.regular },
  captionStrong: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.semibold },
  /** Status chip labels: bold 13. */
  chip: { fontSize: 13, lineHeight: 18, fontFamily: fontFamilies.bold },
  /** Uppercase group labels (sidebar, board sections). */
  overline: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.bold, letterSpacing: 0.96 },
  /** Sidebar items. */
  navItem: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.medium },
  navItemActive: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.bold },
  /** Price · 700, shown in green. */
  price: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold, ...tabular },
  /** Total · 800: a sale's total (cart footer, checkout). */
  total: { fontSize: 30, lineHeight: 36, fontFamily: fontFamilies.heavy, letterSpacing: -0.3, ...tabular },
  /** The one number that must be read across the counter: the change due. */
  hero: { fontSize: 44, lineHeight: 52, fontFamily: fontFamilies.heavy, letterSpacing: -0.88, ...tabular },
  /** Digits on the PIN pad and the qty stepper value. */
  pinKey: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.semibold, ...tabular },
  /** The login brand panel headline (tablet landscape). */
  brandHeadline: { fontSize: 40, lineHeight: 46, fontFamily: fontFamilies.heavy, letterSpacing: -0.8 },
  /** The stacked login header headline (phones, tablet portrait). */
  brandHeadlineCompact: { fontSize: 28, lineHeight: 33, fontFamily: fontFamilies.heavy, letterSpacing: -0.56 },
  /** The sidebar brand title. */
  brandSmall: { fontSize: 15, lineHeight: 20, fontFamily: fontFamilies.bold, letterSpacing: -0.15 },
  /** Small medium-weight caption (the sidebar branch / role line). */
  captionMedium: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.medium },
  /** Dashboard KPI values · 800. */
  kpiValue: { fontSize: 26, lineHeight: 32, fontFamily: fontFamilies.heavy, letterSpacing: -0.26, ...tabular },
  /** Values on total / summary cards · 800. */
  metricValue: { fontSize: 22, lineHeight: 28, fontFamily: fontFamilies.heavy, ...tabular },
  /** Table column headers: 12 / 700, uppercase with letter spacing. */
  tableHeader: { fontSize: 12, lineHeight: 16, fontFamily: fontFamilies.bold, letterSpacing: 0.48, textTransform: 'uppercase' },
  /** Table cells: 14 regular. */
  tableCell: { fontSize: 14, lineHeight: 20, fontFamily: fontFamilies.regular },
  /** The title of a detail pane / settings pane · 700. */
  paneTitle: { fontSize: 20, lineHeight: 26, fontFamily: fontFamilies.bold, letterSpacing: -0.2 },
  /** The brand name beside the logo tile. */
  brandName: { fontSize: 18, lineHeight: 24, fontFamily: fontFamilies.bold },
  /** Brand tagline on the dark panel. */
  brandTagline: { fontSize: 16, lineHeight: 25, fontFamily: fontFamilies.regular },
} as const;

/** Tabular digits for any numeric text that doesn't use a numeric role. */
export const numeric = tabular;

/**
 * Soft shadows using React Native's cross-platform `boxShadow` style (New
 * Architecture; Android 9+). Hairline borders do most of the work; shadows
 * only lift sheets, dialogs, the login card and the primary CTA.
 */
export const shadows = {
  none: { boxShadow: 'none' },
  sm: { boxShadow: '0px 1px 2px rgba(24, 35, 30, 0.04)' },
  md: { boxShadow: '0px 1px 2px rgba(24, 35, 30, 0.04), 0px 6px 16px rgba(24, 35, 30, 0.05)' },
  /** Sheets, dialogs, the login card. */
  lg: { boxShadow: '0px 1px 2px rgba(24, 35, 30, 0.04), 0px 12px 32px rgba(24, 35, 30, 0.08)' },
  /** The primary CTA: a soft green glow. */
  primary: { boxShadow: '0px 6px 16px rgba(47, 125, 90, 0.22)' },
  /** The selected segment of a segmented control. */
  segment: { boxShadow: '0px 1px 2px rgba(24, 35, 30, 0.08)' },
  /** A focused input: a 4 px soft-green ring. */
  focusRing: { boxShadow: `0px 0px 0px 4px ${colors.primarySoft}` },
  /** Under the top bar: none (flat, with a hairline bottom border). */
  bar: { boxShadow: 'none' },
  /** The floating dark phone cart bar: a deep emerald glow. */
  dark: { boxShadow: '0px 10px 24px rgba(32, 90, 66, 0.28)' },
} as const;

/** Minimum touch targets (dp). */
export const hitTarget = {
  /** Any pressable: at least 44×44 (grown with hitSlop where the visual is smaller than 48). */
  min: 44,
  /** Controls and primary actions: 48 high. */
  primary: 48,
  /** Large primary actions (Charge, Sign in). */
  large: 56,
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
  inputHeight: 52,
  /** Round icon buttons: `md` is the 44 minimum (hitSlop grows it to 48), `lg` is 48. */
  iconButton: { md: hitTarget.min, lg: hitTarget.primary },
  /** The decorative round "+" on a product tile (the whole tile is the button). */
  addBadge: 32,
  /** Top bar height, without the safe area. */
  topBar: { phone: 56, tablet: 64 },
  /** Status chips on the top bar (Sell): the pill height; hitSlop grows the touch area to 44. */
  statusChipHeight: 36,
  /** Round brand mark on the login screen (legacy sizes). */
  brandMark: { compact: 44, regular: 64, large: 88 },
  /** The white rounded-square logo tile on the login brand panel. */
  brandTile: 48,
  /** The feature-row icon tiles on the brand panel. */
  brandFeatureTile: 32,
  /** The faint leaf outline on the brand panel (side panel / stacked header). */
  brandLeaf: { side: 520, header: 300 },
  /** Minimum height of the stacked login header (phones, tablet portrait). */
  loginHeader: { phone: 300, tablet: 340 },
  /** Width of the login form card (tablets). */
  loginCardWidth: 420,
  /** Round icon badge at the top of a card / dialog / state. */
  badge: { md: 40, lg: 64 },
  /** Chips are small pills; their text stays ≥ 12. */
  chipMinHeight: 28,
  /** The dot inside a status chip. */
  chipDot: 7,
  /** Segmented control track height. */
  segmentedHeight: 48,
  /** Product / category images keep this width:height ratio. */
  cardImageAspectRatio: 4 / 3,
  /** Square thumbnail, e.g. a category row in the picker sheet. */
  thumbnail: 48,
  /** Inventory (v1 completion): the product image beside an inventory card's text. */
  inventoryThumb: 72,
  /** PIN pad: key height (large, for counter use) and the entered-digit dots. */
  pinKey: 56,
  pinDot: 12,
  /** Width of the qty value between a stepper's − and + buttons. */
  stepperValue: 40,
  /** Stepper − / + buttons (hitSlop keeps the touch area ≥ 44). */
  stepperButton: 44,
  /** A status dot (printer reachability, status chips). */
  statusDot: 8,
  /** The ✓ box of a multi-select row (e.g. a printer's categories). */
  checkbox: 24,
  /** The grab handle on top of a bottom sheet. */
  sheetHandle: { width: 40, height: 4 },
  /** Loading skeleton blocks. */
  skeleton: { line: 12, lineLarge: 18, row: 72, tile: 120 },
  /** DataTable: the default fixed row height. */
  tableRow: 52,
  /** The primary bar on the left edge of a selected table / settings row. */
  selectedBar: 3,
  /** The extra-large CTA (Charge, Complete sale, New sale). */
  cta: 60,
  /** Cash keypad keys (checkout). */
  keypadKey: 64,
  /** Payment method tiles (checkout). */
  methodTile: 84,
  /** The image panel of a Sell product tile. */
  tileImage: { phone: 72, tablet: 96 },
  /** The floating phone cart bar. */
  cartBar: 64,
  /** The coloured bar on a summary card (inventory / purchasing summaries). */
  summaryBar: { phone: 4, tablet: 10 },
  /** The row of a `ListRow` (settings nav, menu rows). */
  listRow: 56,
  /** Compact choice chips / segmented controls in card headers. */
  chipCompact: 40,
  segmentedCompact: 36,
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
  /** Shortest side at or above which the device counts as a tablet. */
  tabletMinShortSide: 600,
  /** Height below which the layout is "compact" (short landscape). */
  compactMaxHeight: 480,
  /** Max width of a centred form / login card. */
  formMaxWidth: 480,
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
  /** Sell screen: width of the vertical category rail (tablet landscape). */
  categoryRailWidth: 220,
  /** Sell screen: width of the permanently visible cart panel (tablet landscape). */
  cartPanelWidth: 340,
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

/** Animation durations (ms). */
export const motion = {
  /** Cross-fade when a remote image finishes loading. */
  imageFadeMs: 150,
  /** Slide-in drawer / overlay sidebar, and its scrim fade. */
  drawerMs: 220,
  /** One half of a loading skeleton's pulse (native driver). */
  skeletonPulseMs: 700,
} as const;

/**
 * App-shell sidebar (see `src/components/shell`): a flat white panel with a
 * hairline right border. Grouped uppercase labels (`textSecondary`, 4.9:1);
 * quiet 44 dp rows in `textResting`; the active item is a soft-green pill
 * (#E8F3ED) with dark-emerald text (7.6:1) and a primary icon. Disabled
 * ("Soon") items are dimmed with `opacity.disabled`, which WCAG exempts for
 * inactive controls.
 */
export const sidebar = {
  /** Persistent expanded panel (tablet landscape), including its padding. */
  widthExpanded: 240,
  /** Collapsed icon rail. */
  widthRail: 80,
  /** Slide-in drawer / overlay panel: at most this wide… */
  drawerMaxWidth: 300,
  /** …and at most this share of the window width (a strip of scrim stays tappable). */
  drawerMaxShare: 0.86,
  /** Rounded outer (right) corners of the slide-in drawer / overlay panel. */
  panelRadius: radius.xl,
  /** Inner padding of the panel. */
  panelPadding: spacing.lg,
  /** Inner padding of the rail. */
  railPadding: spacing.md,
  /** Gap between the persistent panel and the screen edges (flat, flush panel: none). */
  outerMargin: 0,
  /** Height of the brand block on top. */
  brandHeight: 56,
  /** Expanded nav item height: at least the 44 touch target. */
  itemHeight: 44,
  /** Rail nav item: a rounded square button. */
  railItemSize: 48,
  /** Rounded-square logo mark. */
  logoSize: 40,
  logoSizeCompact: 36,
  /** The small round collapse chevron: drawn at 32, touch area grown to 44 with hitSlop. */
  chevronSize: 32,
  chevronHitSlop: 6,
  /** Round initials avatar in the footer. */
  avatarSize: 36,
  colors: {
    panel: colors.surface,
    border: colors.border,
    text: colors.text,
    textMuted: colors.textSecondary,
    groupLabel: colors.textSecondary,
    itemText: colors.textResting,
    item: colors.transparent,
    itemPressed: colors.surfaceMuted,
    /** The active item: a soft-green pill, dark-emerald text and a primary icon. */
    active: colors.primarySoft,
    activePressed: colors.primarySoftPressed,
    activeText: colors.primaryDark,
    activeIcon: colors.primary,
    logo: colors.primary,
    logoText: colors.onPrimary,
    chevron: colors.surfaceMuted,
    chevronPressed: colors.surfacePressed,
    soonTag: colors.surfaceMuted,
    soonText: colors.textSecondary,
    divider: colors.border,
    avatar: colors.primarySoft,
    avatarText: colors.primaryDark,
    /** Footer actions (Switch user, Log out): quiet rows. */
    footerAction: colors.transparent,
    footerActionPressed: colors.surfaceMuted,
    scrim: colors.overlay,
  },
} as const;

/**
 * Charts (`src/components/charts`), drawn with react-native-svg.
 *
 * `series` is rebased on the Sage Emerald brand: slot 1 primary, slot 2
 * processing blue, slot 3 highlight gold, slot 4 sage accent, assigned in
 * fixed slot order and never cycled (blue sits second so a 2-series chart
 * never pairs two greens). Slots 3 and 4 are below 3:1 against white, so
 * every chart carries direct labels or legend values, and a table view.
 * Text never wears a series colour: labels use the text tokens.
 */
export const chart = {
  series: [colors.primary, status.processing.color, colors.highlight, colors.accent],
  /** Extra categories folded into "Other" (never a generated hue). */
  other: '#A7B3AC',
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

/** Pressed feedback: a subtle shrink. */
export const pressedScale = 0.97;

export const theme = {
  colors,
  status,
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
