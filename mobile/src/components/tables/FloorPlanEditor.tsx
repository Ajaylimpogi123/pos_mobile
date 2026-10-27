import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { useShell } from '@/components/shell/ShellContext';
import { FloorPlanGrid, floorBoxStyle, floorCellSize } from '@/components/tables/FloorPlanGrid';
import { FLOOR_PLAN_PHONE_NOTE, seatsLabel, tableLabel } from '@/components/tables/tableLabels';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ChoiceChip } from '@/components/ui/ChoiceChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingState } from '@/components/ui/LoadingState';
import { QtyStepper } from '@/components/ui/QtyStepper';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { colors, layout, opacity, radius, shadows, sizes, spacing, typography } from '@/constants/theme';
import type { EditorTable, FloorPlanEditorState } from '@/hooks/tables/useFloorPlanEditor';
import { useResponsive } from '@/hooks/useResponsive';
import { getErrorMessage } from '@/services/api';
import type { TableShape } from '@/services/types';
import { isPlaced, TABLE_MAX_CELLS, TABLE_MIN_CELLS } from '@pos/core/tables/floorPlan';

const SHAPES: readonly SegmentOption<TableShape>[] = [
  { value: 'rect', label: 'Rectangle', icon: 'square-outline', testID: 'floor-shape-rect' },
  { value: 'round', label: 'Round', icon: 'ellipse-outline', testID: 'floor-shape-round' },
];

/** A drag shorter than this (dp) is a tap. */
const DRAG_MIN_DISTANCE = 6;

type Rect = { x: number; y: number; width: number; height: number };

type PlanTableProps = {
  table: EditorTable;
  cell: number;
  selected: boolean;
  issue: string | null;
  editable: boolean;
  onSelect: (id: number) => void;
  onDrop: (id: number, x: number, y: number) => boolean;
};

/** A placed table in the editor: tap selects it; dragging moves it and it snaps to cells on release. */
function PlanTable({ table, cell, selected, issue, editable, onSelect, onDrop }: PlanTableProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(editable)
    .minDistance(DRAG_MIN_DISTANCE)
    .onStart(() => {
      lifted.set(1);
      onSelect(table.id);
    })
    .onUpdate((event) => {
      tx.set(event.translationX);
      ty.set(event.translationY);
    })
    .onEnd((event) => {
      onDrop(table.id, (table.pos_x ?? 0) + event.translationX / cell, (table.pos_y ?? 0) + event.translationY / cell);
    })
    .onFinalize(() => {
      tx.set(0);
      ty.set(0);
      lifted.set(0);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onSelect(table.id));
  const gesture = Gesture.Exclusive(pan, tap);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }],
    zIndex: lifted.get() > 0 ? 2 : 1,
    opacity: lifted.get() > 0 ? opacity.pressed : 1,
  }));

  const label = `${tableLabel(table.name)}, ${seatsLabel(table.seats)}, ${table.width} by ${table.height}${table.is_active ? '' : ', inactive'}${issue ? `. ${issue}` : ''}`;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={editable ? 'Selects the table. Drag to move it.' : undefined}
        accessibilityState={{ selected }}
        onAccessibilityTap={() => onSelect(table.id)}
        style={[
          floorBoxStyle(table, cell),
          styles.planTable,
          !table.is_active && styles.inactive,
          selected && styles.selected,
          issue !== null && styles.issue,
          animated,
        ]}
        testID={`floor-table-${table.id}`}
      >
        <Text style={styles.planName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {table.name}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
}

type TrayItemProps = {
  table: EditorTable;
  selected: boolean;
  onSelect: (id: number) => void;
  onDragStart: (table: EditorTable) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (table: EditorTable, x: number, y: number) => void;
  onDragCancel: () => void;
};

/** An unplaced table: tap selects it (then tap a cell or **Place on plan**); drag it onto the plan. */
function TrayItem({ table, selected, onSelect, onDragStart, onDragMove, onDragEnd, onDragCancel }: TrayItemProps) {
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(DRAG_MIN_DISTANCE)
    .onStart(() => onDragStart(table))
    .onUpdate((event) => onDragMove(event.absoluteX, event.absoluteY))
    .onEnd((event) => onDragEnd(table, event.absoluteX, event.absoluteY))
    .onFinalize((_event, success) => {
      if (!success) onDragCancel();
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onSelect(table.id));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${tableLabel(table.name)}, not on the plan`}
        accessibilityHint="Selects the table. Drag it onto the plan."
        accessibilityState={{ selected }}
        onAccessibilityTap={() => onSelect(table.id)}
        style={[styles.trayItem, selected && styles.selected, !table.is_active && styles.inactive]}
        testID={`floor-tray-${table.id}`}
      >
        <Text style={styles.planName} numberOfLines={1}>
          {table.name}
        </Text>
        <Text style={styles.trayMeta} numberOfLines={1}>
          {seatsLabel(table.seats)}
        </Text>
      </View>
    </GestureDetector>
  );
}

/** The selected table's size, shape, nudge arrows and **Remove from plan** / **Place on plan**. */
function SelectionPanel({ editor, table }: { editor: FloorPlanEditorState; table: EditorTable }) {
  const placed = isPlaced(table);
  const issue = editor.issues[table.id] ?? null;
  return (
    <View style={styles.panelCard} testID="floor-selection">
      <Text style={styles.panelTitle} accessibilityRole="header">
        {tableLabel(table.name)}
      </Text>
      <Text style={styles.trayMeta}>
        {seatsLabel(table.seats)}
        {table.is_active ? '' : ' · Inactive'}
      </Text>
      {issue ? <Banner message={issue} testID="floor-selection-issue" /> : null}
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>Width</Text>
        <QtyStepper
          value={table.width}
          onChange={(width) => editor.resize(table.id, { width })}
          min={TABLE_MIN_CELLS}
          max={TABLE_MAX_CELLS}
          accessibilityLabel="Width in cells"
          disabled={editor.saving}
          testID="floor-width"
        />
      </View>
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>Height</Text>
        <QtyStepper
          value={table.height}
          onChange={(height) => editor.resize(table.id, { height })}
          min={TABLE_MIN_CELLS}
          max={TABLE_MAX_CELLS}
          accessibilityLabel="Height in cells"
          disabled={editor.saving}
          testID="floor-height"
        />
      </View>
      <SegmentedControl<TableShape>
        options={SHAPES}
        value={table.shape}
        onChange={(shape) => editor.setShape(table.id, shape)}
        size="compact"
        disabled={editor.saving}
        accessibilityLabel="Shape"
        testID="floor-shape"
      />
      {placed ? (
        <>
          <View style={styles.nudgeRow}>
            <IconButton icon="arrow-back" variant="soft" accessibilityLabel="Move left one cell" onPress={() => editor.nudge(table.id, -1, 0)} disabled={editor.saving} testID="floor-nudge-left" />
            <IconButton icon="arrow-up" variant="soft" accessibilityLabel="Move up one cell" onPress={() => editor.nudge(table.id, 0, -1)} disabled={editor.saving} testID="floor-nudge-up" />
            <IconButton icon="arrow-down" variant="soft" accessibilityLabel="Move down one cell" onPress={() => editor.nudge(table.id, 0, 1)} disabled={editor.saving} testID="floor-nudge-down" />
            <IconButton icon="arrow-forward" variant="soft" accessibilityLabel="Move right one cell" onPress={() => editor.nudge(table.id, 1, 0)} disabled={editor.saving} testID="floor-nudge-right" />
          </View>
          <Button title="Remove from plan" variant="danger" leftIcon="remove-circle-outline" onPress={() => editor.unplace(table.id)} disabled={editor.saving} testID="floor-remove" />
        </>
      ) : (
        <>
          <Text style={styles.help}>Tap a cell on the plan to put it there, or:</Text>
          <Button title="Place on plan" variant="secondary" leftIcon="add" onPress={() => editor.placeFirstFree(table.id)} disabled={editor.saving} testID="floor-place" />
        </>
      )}
    </View>
  );
}

/**
 * Tables → **Floor plan** (Table Management §B and §F): the area picker, the
 * plan and the **Unplaced** tray. Drag a table onto the plan or across it
 * (it snaps to cells); select it for its size, shape and **Remove from
 * plan**; **Save** or **Discard**. The shared fit and overlap check marks
 * problems in red before saving. Phones show the plan view-only, with the
 * note `Edit the floor plan on a tablet or computer.`
 */
export function FloorPlanEditor({ editor, online }: { editor: FloorPlanEditorState; online: boolean }) {
  const { width, isPhone, isLandscape, screenPaddingX, screenPaddingY, gutter } = useResponsive();
  const { sidebarWidth } = useShell();
  const editable = !isPhone;
  const side = editable && isLandscape;

  const rootRef = useRef<View>(null);
  const canvasRef = useRef<View>(null);
  const origins = useRef<{ root: Rect; canvas: Rect } | null>(null);
  const [ghost, setGhost] = useState<EditorTable | null>(null);
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: ghostX.get() }, { translateY: ghostY.get() }] }));

  const available = width - sidebarWidth - 2 * screenPaddingX - (side ? layout.floorSidePanelWidth + gutter : 0);
  const cell = floorCellSize(available);
  const { query } = editor;

  if (query.isPending) return <LoadingState variant="list" message="Loading the floor plan…" testID="floor-loading" />;
  const refresh = <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />;
  if (query.error && editor.areaTables.length === 0) {
    return (
      <ErrorState title="Couldn't load the tables" message={getErrorMessage(query.error)} onRetry={() => void query.refetch()} refreshControl={refresh} testID="floor-error" />
    );
  }
  if (!editor.area) {
    return (
      <EmptyState
        title="No tables yet"
        message="Add tables in the List tab, then place them on the plan."
        icon="map-outline"
        refreshControl={refresh}
        testID="floor-empty"
      />
    );
  }

  function measure(view: View | null): Promise<Rect | null> {
    return new Promise((resolve) => {
      if (!view) resolve(null);
      else view.measureInWindow((x, y, w, h) => resolve({ x, y, width: w, height: h }));
    });
  }

  function dragStart(table: EditorTable) {
    editor.select(table.id);
    // Off screen until the first move has a position.
    ghostX.set(-layout.floorCellMax * 10);
    ghostY.set(-layout.floorCellMax * 10);
    setGhost(table);
    void Promise.all([measure(rootRef.current), measure(canvasRef.current)]).then(([root, canvas]) => {
      origins.current = root && canvas ? { root, canvas } : null;
    });
  }

  function dragMove(x: number, y: number) {
    const root = origins.current?.root;
    if (!root) return;
    ghostX.set(x - root.x - layout.floorTrayItemSize / 2);
    ghostY.set(y - root.y - layout.floorTrayItemSize / 2);
  }

  function dragEnd(table: EditorTable, x: number, y: number) {
    const canvas = origins.current?.canvas;
    setGhost(null);
    if (!canvas) return;
    const inside = x >= canvas.x && x <= canvas.x + canvas.width && y >= canvas.y && y <= canvas.y + canvas.height;
    // The finger holds the table's middle.
    if (inside) editor.moveTo(table.id, (x - canvas.x) / cell - table.width / 2, (y - canvas.y) / cell - table.height / 2);
  }

  const areaPicker =
    editor.areas.length > 1 ? (
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Area">
        {editor.areas.map((group) => (
          <ChoiceChip
            key={group.key}
            label={`${group.title} · ${group.items.length}`}
            selected={group.key === editor.area?.key}
            onPress={() => editor.chooseArea(group.key)}
            disabled={editor.saving || editor.dirty}
            testID={`floor-area-${group.key}`}
          />
        ))}
      </View>
    ) : null;

  const plan = (
    <View ref={canvasRef} collapsable={false} style={styles.planWrap}>
      <FloorPlanGrid
        cell={cell}
        availableWidth={available}
        onPressCell={editable && editor.selected ? editor.placeAtCell : undefined}
        pressCellLabel={editor.selected ? `Put ${tableLabel(editor.selected.name)} here` : undefined}
        testID="floor-plan"
      >
        {editor.placed.map((table) => (
          <PlanTable
            key={table.id}
            table={table}
            cell={cell}
            selected={table.id === editor.selected?.id}
            issue={editor.issues[table.id] ?? null}
            editable={editable && !editor.saving}
            onSelect={(id) => editor.select(editable ? id : null)}
            onDrop={editor.moveTo}
          />
        ))}
      </FloorPlanGrid>
    </View>
  );

  if (!editable) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY }]} refreshControl={refresh} testID="floor-view-only">
        <Banner message={FLOOR_PLAN_PHONE_NOTE} variant="info" testID="floor-phone-note" />
        {areaPicker}
        {plan}
        {editor.unplaced.length > 0 ? (
          <Text style={styles.help} testID="floor-unplaced-list">
            Not on the plan: {editor.unplaced.map((table) => table.name).join(', ')}
          </Text>
        ) : null}
      </ScrollView>
    );
  }

  const tray = (
    <View style={styles.panelCard} testID="floor-tray">
      <Text style={styles.panelTitle} accessibilityRole="header">
        Unplaced · {editor.unplaced.length}
      </Text>
      {editor.unplaced.length === 0 ? (
        <Text style={styles.help}>Every table of this area is on the plan.</Text>
      ) : (
        <View style={styles.trayList}>
          {editor.unplaced.map((table) => (
            <TrayItem
              key={table.id}
              table={table}
              selected={table.id === editor.selected?.id}
              onSelect={editor.select}
              onDragStart={dragStart}
              onDragMove={dragMove}
              onDragEnd={dragEnd}
              onDragCancel={() => setGhost(null)}
            />
          ))}
        </View>
      )}
    </View>
  );

  const panel = (
    <View style={[styles.panel, side && styles.panelSide]}>
      {editor.selected ? <SelectionPanel editor={editor} table={editor.selected} /> : <Text style={styles.help}>Select a table to change its size or shape.</Text>}
      {tray}
    </View>
  );

  return (
    <GestureHandlerRootView style={styles.fill}>
      <View ref={rootRef} collapsable={false} style={styles.fill}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingHorizontal: screenPaddingX, paddingBottom: screenPaddingY }]}
          refreshControl={refresh}
          keyboardShouldPersistTaps="handled"
          testID="floor-editor"
        >
          {editor.banner ? <Banner message={editor.banner} testID="floor-banner" /> : null}
          {!online ? <Banner message="Saving the floor plan needs a connection." variant="warning" testID="floor-offline" /> : null}
          {areaPicker}
          {editor.dirty && editor.areas.length > 1 ? <Text style={styles.help}>Save or discard to switch areas.</Text> : null}
          <View style={[side ? styles.row : styles.column, { gap: gutter }]}>
            {plan}
            {panel}
          </View>
          <View style={styles.actions}>
            <Button title="Discard" variant="secondary" onPress={editor.discard} disabled={!editor.dirty || editor.saving} testID="floor-discard" />
            <Button
              title={editor.dirty ? 'Save' : 'Saved'}
              leftIcon="checkmark"
              onPress={editor.save}
              loading={editor.saving}
              disabled={!editor.dirty || editor.saving || !online}
              testID="floor-save"
            />
          </View>
        </ScrollView>
        {ghost ? (
          <Animated.View pointerEvents="none" style={[styles.ghost, ghostStyle]} testID="floor-ghost">
            <Text style={styles.planName} numberOfLines={1}>
              {ghost.name}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  column: {
    flexDirection: 'column',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  planWrap: {
    flexShrink: 1,
  },
  planTable: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxs,
    borderWidth: sizes.borderWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  planName: {
    ...typography.controlStrong,
    color: colors.text,
    textAlign: 'center',
  },
  inactive: {
    opacity: opacity.dimmed,
  },
  selected: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.green,
    backgroundColor: colors.greenSoft,
  },
  issue: {
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  panel: {
    gap: spacing.md,
  },
  panelSide: {
    width: layout.floorSidePanelWidth,
  },
  panelCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: sizes.borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelTitle: {
    ...typography.section,
    color: colors.text,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  stepLabel: {
    ...typography.label,
    color: colors.text,
  },
  nudgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  help: {
    ...typography.bodySm,
    color: colors.textSecondary,
  },
  trayList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  trayItem: {
    width: layout.floorTrayItemSize,
    height: layout.floorTrayItemSize,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    borderRadius: radius.md,
    borderWidth: sizes.borderWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  trayMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: layout.floorTrayItemSize,
    height: layout.floorTrayItemSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: sizes.borderWidthFocus,
    borderColor: colors.green,
    backgroundColor: colors.greenSoft,
    opacity: opacity.pressed,
    ...shadows.lg,
  },
});
