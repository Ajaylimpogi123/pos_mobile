/**
 * DataTable: a generic, typed, Stripe-style table for list and report screens.
 *
 * Look (MASTER §3 data table): one white card (radius 12, hairline border)
 * with a 40 dp column-header row (13 / 500, `muted-text`, not uppercase),
 * ~52 dp rows split by `border` rules (12 px padding), right-aligned tabular
 * numbers, a #FAFAFA pressed row, an optional bold totals footer, an optional
 * row-actions (⋯) column, and a selected row on the `accent` fill with a
 * 3 dp green bar on its left edge.
 *
 * It is also the screen's scroll container: a virtualised `FlatList`
 * (`keyExtractor`, `getItemLayout` for fixed-height rows, a modest
 * `windowSize`), with the content above the table (filters, totals, charts)
 * passed as `ListHeaderComponent`, so the whole page scrolls as one list.
 *
 * Props
 * - `columns`: `{ key, header, flex? | width?, align?: 'left' | 'right', render?(row, index), headerAccessibilityLabel? }[]`.
 *   `width` is a fixed dp width; otherwise the column takes `flex` (default 1)
 *   of the remaining width. `align: 'right'` right-aligns the cell and header
 *   (use it for numbers: strings in right-aligned cells get tabular digits).
 *   `render` returns a node (a string is drawn as a one-line cell); without
 *   it the cell shows `row[key]` ("—" when null). Pick the columns for the
 *   current size from `useResponsive()` and **memoise the array** (`useMemo`)
 *   so rows don't re-render on unrelated state.
 * - `rows`, `keyExtractor(row, index)`: the data (render order) and a stable key.
 * - `onRowPress?(row)`: makes rows pressable (immediate pressed fill). Needn't be memoised.
 * - `rowAccessibilityLabel?(row)`: what a screen reader says for a row.
 * - `rowAccessible?`: default true. `false` keeps a non-pressable row from grouping its
 *   cells into one element, so inline buttons (e.g. Approve / Decline) stay reachable; the
 *   label then goes on the first cell instead.
 * - `rowAccessibilityHint?`: e.g. "Opens the receipt" (pressable rows), or one per row.
 * - `rowTestID?(row)`: a row's test ID; when pressable, the pressable is `<id>-open`.
 * - `selectedKey?`: the key of the selected row (soft fill + left primary bar).
 * - `footer?`: the totals row, `{ [columnKey]: node }` (strings are drawn bold; cells get `<testID>-footer-<key>`).
 * - `loading?`: first load: skeleton rows under the column headers (never a spinner).
 * - `empty?`: shown instead of the rows when there are none and not loading (e.g. an `<EmptyState>`).
 * - `renderCard?(row, index)`: on phones (`useResponsive().isPhone`) rows render as these cards instead.
 * - `cardsInPortrait?`: back-office lists (MASTER §6): the cards in portrait on tablets too; the table only in landscape.
 * - `renderFooterCard?()`: on phones (with `renderCard`), the totals card drawn after the cards.
 * - `rowActions?(row)`: the last cell, e.g. a ⋯ `IconButton` with an `accessibilityLabel` that names the row.
 * - `pagination?`: the cursor footer ("Showing n" and **Load more**; see `LoadMoreFooter`), after the table.
 * - `rowHeight?`: `number` (default 52) for fixed-height rows (enables `getItemLayout`),
 *   or `'auto'` for rows whose height varies (multi-line cells).
 * - List pass-throughs: `ListHeaderComponent`, `ListFooterComponent`,
 *   `refreshControl`, `onEndReached`, `onEndReachedThreshold`,
 *   `contentContainerStyle` (padding / max width; don't set `gap`),
 *   `scrollEnabled` (false inside a parent ScrollView), `extraData`.
 * - `testID`: the list. Also `<id>-header`, `<id>-footer`, `<id>-loading`.
 */
import { memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { LoadMoreFooter, type LoadMoreState } from '@/components/ui/LoadMoreFooter';
import { Skeleton, SkeletonPulse } from '@/components/ui/Skeleton';
import {
  colors,
  fontFamilies,
  hitTarget,
  layout,
  numeric,
  radius,
  sizes,
  spacing,
  typography,
} from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { NO_VALUE } from '@pos/core/numbers';

export type DataTableAlign = 'left' | 'right';

export type DataTableColumn<T> = {
  /** Unique within the table; also the default field read from the row. */
  key: string;
  /** Column header. */
  header: string;
  /** Share of the width left after fixed columns (default 1). Ignored with `width`. */
  flex?: number;
  /** A fixed width in dp. */
  width?: number;
  align?: DataTableAlign;
  /** The cell. A string or number is drawn as one line of cell text. */
  render?: (row: T, index: number) => ReactNode;
  /** Spoken header when the visible one is an abbreviation (e.g. "Ret." → "Returned"). */
  headerAccessibilityLabel?: string;
};

export type DataTableFooter = Readonly<Record<string, ReactNode>>;

export type DataTableProps<T> = {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  keyExtractor: (row: T, index: number) => string;
  onRowPress?: (row: T) => void;
  rowAccessibilityLabel?: (row: T) => string;
  /** `false`: a non-pressable row doesn't group its cells, so inner buttons stay reachable (default true). */
  rowAccessible?: boolean;
  rowAccessibilityHint?: string | ((row: T) => string);
  rowTestID?: (row: T) => string;
  selectedKey?: string | null;
  footer?: DataTableFooter | null;
  loading?: boolean;
  /** Skeleton rows while loading (default 6). */
  loadingRows?: number;
  empty?: ReactElement | null;
  renderCard?: (row: T, index: number) => ReactElement;
  /** MASTER §6 lists: cards in portrait (tablets too), the table in landscape. */
  cardsInPortrait?: boolean;
  /** Phones (card layout): the totals card after the cards (the tablet `footer` row isn't drawn there). */
  renderFooterCard?: () => ReactElement | null;
  /** The row-actions (⋯) cell at the end of each row (tablet table only). */
  rowActions?: (row: T) => ReactNode;
  /** The cursor footer: "Showing n" and **Load more**. */
  pagination?: LoadMoreState | null;
  rowHeight?: number | 'auto';
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollEnabled?: boolean;
  extraData?: unknown;
  testID?: string;
};

/** Default fixed row height: 52 dp. */
export const DATA_TABLE_ROW_HEIGHT = sizes.tableRow;
const LOADING_ROWS = 6;
/** Rows are small: render a screenful, keep ~5 screens around the viewport. */
const WINDOW_SIZE = 11;
const INITIAL_ROWS = 16;

function columnStyle<T>(column: DataTableColumn<T>): ViewStyle {
  return column.width !== undefined ? { width: column.width } : { flex: column.flex ?? 1 };
}

/** Default cell content: the row's `key` field. */
function defaultCell<T>(row: T, key: string): ReactNode {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return NO_VALUE;
  if (typeof value === 'string' || typeof value === 'number') return value;
  return NO_VALUE;
}

// ---------------------------------------------------------------------------
// Cell text
// ---------------------------------------------------------------------------

export type CellTextVariant = 'default' | 'strong' | 'muted' | 'total';

type CellTextProps = {
  children: ReactNode;
  variant?: CellTextVariant;
  align?: DataTableAlign;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * Text for a custom cell: `default` (14 regular), `strong` (14 semibold),
 * `muted` (the 12 secondary line under a value), `total` (the bold footer).
 * Right-aligned text gets tabular digits.
 */
export const CellText = memo(function CellText({
  children,
  variant = 'default',
  align = 'left',
  numberOfLines = 1,
  style,
  testID,
}: CellTextProps) {
  return (
    <Text
      style={[textStyles[variant], align === 'right' && textStyles.right, style]}
      numberOfLines={numberOfLines}
      testID={testID}
    >
      {children}
    </Text>
  );
});

function CellContent({ content, align, footer, testID }: { content: ReactNode; align: DataTableAlign; footer?: boolean; testID?: string }) {
  if (typeof content === 'string' || typeof content === 'number') {
    return (
      <CellText variant={footer ? 'total' : 'default'} align={align} testID={testID}>
        {content}
      </CellText>
    );
  }
  return <>{content}</>;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function HeaderRow<T>({ columns, actions, testID }: { columns: readonly DataTableColumn<T>[]; actions: boolean; testID?: string }) {
  return (
    <View style={[styles.frame, styles.headerRow]} testID={testID}>
      {columns.map((column) => (
        <View key={column.key} style={[styles.cell, columnStyle(column), column.align === 'right' && styles.cellRight]}>
          <Text
            style={[styles.headerText, column.align === 'right' && textStyles.right]}
            numberOfLines={2}
            accessibilityLabel={column.headerAccessibilityLabel}
          >
            {column.header}
          </Text>
        </View>
      ))}
      {actions ? <View style={styles.actionsCell} accessibilityLabel="Actions" /> : null}
    </View>
  );
}

type RowProps<T> = {
  row: T;
  index: number;
  columns: readonly DataTableColumn<T>[];
  minHeight: number;
  last: boolean;
  selected: boolean;
  onPress: ((row: T) => void) | null;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** false: the (non-pressable) row doesn't group its cells; the label goes on the first cell. */
  grouped: boolean;
  actions: ((row: T) => ReactNode) | null;
  testID?: string;
};

function DataTableRow<T>({
  row,
  index,
  columns,
  minHeight,
  last,
  selected,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  grouped,
  actions,
  testID,
}: RowProps<T>) {
  const labelFirstCell = !onPress && !grouped && accessibilityLabel !== undefined;
  const cells = columns.map((column, columnIndex) => {
    const labelled = labelFirstCell && columnIndex === 0;
    return (
      <View
        key={column.key}
        style={[styles.cell, columnStyle(column), column.align === 'right' && styles.cellRight]}
        accessible={labelled || undefined}
        accessibilityLabel={labelled ? accessibilityLabel : undefined}
      >
        <CellContent content={column.render ? column.render(row, index) : defaultCell(row, column.key)} align={column.align ?? 'left'} />
      </View>
    );
  });

  return (
    <View style={[styles.frame, styles.row, last && styles.lastRow, selected && styles.selectedRow]} testID={testID}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ selected }}
          onPress={() => onPress(row)}
          testID={testID ? `${testID}-open` : undefined}
          style={({ pressed }) => [
            styles.cells,
            actions && styles.cellsWithActions,
            { minHeight },
            last && styles.lastRowInner,
            pressed && (selected ? styles.selectedPressed : styles.pressed),
          ]}
        >
          {cells}
        </Pressable>
      ) : (
        <View
          style={[styles.cells, actions && styles.cellsWithActions, { minHeight }]}
          accessible={grouped && accessibilityLabel !== undefined}
          accessibilityLabel={grouped ? accessibilityLabel : undefined}
        >
          {cells}
        </View>
      )}
      {actions ? <View style={styles.actionsOverlay}>{actions(row)}</View> : null}
      {selected ? <View style={styles.selectedBar} /> : null}
    </View>
  );
}

const MemoRow = memo(DataTableRow) as typeof DataTableRow;

function FooterRow<T>({ columns, footer, actions, testID }: { columns: readonly DataTableColumn<T>[]; footer: DataTableFooter; actions: boolean; testID?: string }) {
  return (
    <View style={[styles.frame, styles.footerRow, actions && styles.cellsWithActions]} testID={testID}>
      {columns.map((column) => (
        <View key={column.key} style={[styles.cell, columnStyle(column), column.align === 'right' && styles.cellRight]}>
          <CellContent
            content={footer[column.key] ?? null}
            align={column.align ?? 'left'}
            footer
            testID={testID && typeof footer[column.key] === 'string' ? `${testID}-${column.key}` : undefined}
          />
        </View>
      ))}
    </View>
  );
}

function SkeletonRows<T>({ columns, count, height, testID }: { columns: readonly DataTableColumn<T>[]; count: number; height: number; testID?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading…" testID={testID}>
      <SkeletonPulse>
        {Array.from({ length: count }, (_unused, index) => (
          <View key={index} style={[styles.frame, styles.row, index === count - 1 && styles.lastRow]}>
            <View style={[styles.cells, { minHeight: height }]}>
              {columns.map((column, columnIndex) => (
                <View key={column.key} style={[styles.cell, columnStyle(column), column.align === 'right' && styles.cellRight]}>
                  <Skeleton width={columnIndex === 0 ? '70%' : '50%'} />
                </View>
              ))}
            </View>
          </View>
        ))}
      </SkeletonPulse>
    </View>
  );
}

function SkeletonCards({ count, gap, testID }: { count: number; gap: number; testID?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading…" testID={testID}>
      <SkeletonPulse style={{ gap }}>
        {Array.from({ length: count }, (_unused, index) => (
          <View key={index} style={styles.skeletonCard}>
            <Skeleton width="55%" height={sizes.skeleton.lineLarge} />
            <Skeleton width="35%" />
          </View>
        ))}
      </SkeletonPulse>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  onRowPress,
  rowAccessibilityLabel,
  rowAccessible = true,
  rowAccessibilityHint,
  rowTestID,
  selectedKey = null,
  footer = null,
  loading = false,
  loadingRows = LOADING_ROWS,
  empty = null,
  renderCard,
  cardsInPortrait = false,
  renderFooterCard,
  rowActions,
  pagination = null,
  rowHeight = DATA_TABLE_ROW_HEIGHT,
  ListHeaderComponent = null,
  ListFooterComponent = null,
  refreshControl,
  onEndReached,
  onEndReachedThreshold = 0.5,
  contentContainerStyle,
  scrollEnabled = true,
  extraData,
  testID,
}: DataTableProps<T>) {
  const { isPhone, isPortrait, gutter } = useResponsive();
  const cards = renderCard !== undefined && (isPhone || (cardsInPortrait && isPortrait));
  const fixed = rowHeight !== 'auto' && !cards;
  const minHeight = rowHeight === 'auto' ? DATA_TABLE_ROW_HEIGHT : rowHeight;
  const hasRows = rows.length > 0;
  const cardGap = useMemo(() => ({ marginBottom: gutter }), [gutter]);
  const showLoading = loading && !hasRows;

  // Latest-callback refs: rows get stable handlers, so callers needn't memoise them.
  const pressRef = useRef(onRowPress);
  useLayoutEffect(() => {
    pressRef.current = onRowPress;
  });
  const handlePress = useCallback((row: T) => pressRef.current?.(row), []);
  const pressable = onRowPress !== undefined;
  const actionsRef = useRef(rowActions);
  useLayoutEffect(() => {
    actionsRef.current = rowActions;
  });
  const hasActions = rowActions !== undefined && !cards;
  const renderActions = useCallback((row: T) => actionsRef.current?.(row) ?? null, []);

  // The first row's offset: the measured header (filters, totals, column headers) plus the top padding.
  const headerEnd = useRef(0);
  const padTop = useMemo(() => {
    const flat = StyleSheet.flatten(contentContainerStyle) ?? {};
    const value = flat.paddingTop ?? flat.paddingVertical ?? flat.padding;
    return typeof value === 'number' ? value : 0;
  }, [contentContainerStyle]);
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    headerEnd.current = event.nativeEvent.layout.height;
  }, []);
  const getItemLayout = useCallback(
    (_data: ArrayLike<T> | null | undefined, index: number) => ({
      length: minHeight,
      offset: padTop + headerEnd.current + minHeight * index,
      index,
    }),
    [minHeight, padTop],
  );

  const lastIndex = rows.length - 1;
  const closesTable = !footer;
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<T>) => {
      if (cards && renderCard) return <View style={cardGap}>{renderCard(item, index)}</View>;
      return (
        <MemoRow
          row={item}
          index={index}
          columns={columns}
          minHeight={minHeight}
          last={closesTable && index === lastIndex}
          selected={selectedKey !== null && keyExtractor(item, index) === selectedKey}
          onPress={pressable ? handlePress : null}
          accessibilityLabel={rowAccessibilityLabel?.(item)}
          accessibilityHint={pressable ? (typeof rowAccessibilityHint === 'function' ? rowAccessibilityHint(item) : rowAccessibilityHint) : undefined}
          grouped={rowAccessible}
          actions={hasActions ? renderActions : null}
          testID={rowTestID?.(item)}
        />
      );
    },
    [
      cards,
      renderCard,
      cardGap,
      columns,
      minHeight,
      closesTable,
      lastIndex,
      selectedKey,
      keyExtractor,
      pressable,
      handlePress,
      rowAccessibilityLabel,
      rowAccessible,
      rowAccessibilityHint,
      rowTestID,
      hasActions,
      renderActions,
    ],
  );

  if (!hasRows && !showLoading && empty && !ListHeaderComponent) return empty;

  const showColumns = !cards && (hasRows || showLoading);
  const header = (
    <View onLayout={onHeaderLayout}>
      {ListHeaderComponent ? <View style={showColumns || !hasRows ? cardGap : null}>{ListHeaderComponent}</View> : null}
      {showColumns ? <HeaderRow columns={columns} actions={hasActions} testID={testID ? `${testID}-header` : undefined} /> : null}
    </View>
  );

  let listEmpty: ReactElement | null = null;
  if (showLoading) {
    const loadingID = testID ? `${testID}-loading` : undefined;
    listEmpty = cards ? (
      <SkeletonCards count={loadingRows} gap={gutter} testID={loadingID} />
    ) : (
      <SkeletonRows columns={columns} count={loadingRows} height={minHeight} testID={loadingID} />
    );
  } else if (!hasRows) listEmpty = empty;

  const footerRow = hasRows && footer && !cards;
  const footerCard = hasRows && cards && renderFooterCard ? renderFooterCard() : null;
  const pager = pagination && hasRows ? <LoadMoreFooter {...pagination} testID={testID ? `${testID}-more` : 'data-table-more'} /> : null;
  const listFooter =
    footerRow || footerCard || ListFooterComponent || pager ? (
      <>
        {footerRow ? (
          <FooterRow columns={columns} footer={footer} actions={hasActions} testID={testID ? `${testID}-footer` : undefined} />
        ) : null}
        {footerCard}
        {pager}
        {ListFooterComponent}
      </>
    ) : null;

  return (
    <FlatList
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      getItemLayout={fixed ? getItemLayout : undefined}
      extraData={extraData}
      ListHeaderComponent={header}
      ListEmptyComponent={listEmpty}
      ListFooterComponent={listFooter}
      contentContainerStyle={[!hasRows && !showLoading && styles.grow, contentContainerStyle]}
      refreshControl={refreshControl}
      onEndReached={onEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      scrollEnabled={scrollEnabled}
      initialNumToRender={INITIAL_ROWS}
      windowSize={WINDOW_SIZE}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID={testID}
    />
  );
}


const textStyles = StyleSheet.create({
  default: {
    ...typography.tableCell,
    color: colors.text,
  },
  strong: {
    ...typography.control,
    color: colors.text,
  },
  muted: {
    ...typography.captionMedium,
    color: colors.textSecondary,
  },
  total: {
    ...typography.controlStrong,
    fontFamily: fontFamilies.bold,
    color: colors.text,
  },
  right: {
    ...numeric,
    textAlign: 'right',
  },
});

const styles = StyleSheet.create({
  grow: {
    flexGrow: 1,
  },
  /** The card's side borders, shared by every part of the table. */
  frame: {
    borderLeftWidth: sizes.borderWidth,
    borderRightWidth: sizes.borderWidth,
    borderColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.tableHeader,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderTopWidth: sizes.borderWidth,
    borderBottomWidth: sizes.borderWidth,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  headerText: {
    ...typography.tableHeader,
    color: colors.textSecondary,
  },
  row: {
    backgroundColor: colors.surface,
    borderBottomWidth: sizes.borderWidth,
    borderBottomColor: colors.divider,
  },
  lastRow: {
    borderBottomColor: colors.border,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  lastRowInner: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  selectedRow: {
    backgroundColor: colors.selectedRow,
  },
  selectedBar: {
    pointerEvents: 'none',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: sizes.selectedBar,
    backgroundColor: colors.primary,
  },
  cells: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  /** Room for the row-actions cell drawn over the row's right end. */
  cellsWithActions: {
    paddingRight: layout.rowActionsWidth + spacing.md,
  },
  actionsCell: {
    width: layout.rowActionsWidth,
  },
  actionsOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: spacing.xs,
    width: layout.rowActionsWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: colors.rowHover,
  },
  selectedPressed: {
    backgroundColor: colors.accent,
  },
  cell: {
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: spacing.xxs,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  skeletonCard: {
    minHeight: sizes.skeleton.row,
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: hitTarget.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.subtle,
    borderBottomWidth: sizes.borderWidth,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
});
