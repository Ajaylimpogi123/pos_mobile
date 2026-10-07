import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CardGrid, type GridEmptyProps } from '@/components/shared/CardGrid';
import { DateFilterBar } from '@/components/shared/DateFilterBar';
import { ListHeader } from '@/components/shared/ListHeader';
import { ShiftCard } from '@/components/shifts/ShiftCard';
import { Screen } from '@/components/ui/Screen';
import { shiftRoute } from '@/constants/routes';
import { useShiftListScreen } from '@/hooks/shifts/useShifts';
import type { Shift } from '@/services/types';

function openShift(shift: Shift) {
  router.push(shiftRoute(shift.ulid));
}

function shiftKey(shift: Shift): string {
  return shift.ulid;
}

/**
 * Shifts (`report.zread`): every tablet's shifts from the server, for one
 * business date (today by default) or every date, newest first. Card grid
 * (1–3 columns from `useResponsive`), loading / empty / error with Retry,
 * pull-to-refresh and infinite scroll. Tapping a shift opens its report.
 */
export function ShiftListScreen() {
  const screen = useShiftListScreen();

  let empty: GridEmptyProps;
  if (screen.allDates) empty = { title: 'No shifts yet', message: 'Shifts opened on the tablets show here.', icon: 'time-outline' };
  else if (screen.isToday) {
    empty = { title: 'No shifts today', message: 'A shift shows here once a tablet opens one and syncs.', icon: 'time-outline' };
  } else {
    empty = {
      title: 'No shifts on this day',
      message: 'Try another day, or show all dates.',
      icon: 'calendar-outline',
      actionLabel: 'Show all dates',
      onAction: screen.showAllDates,
    };
  }

  return (
    <Screen edges={[]} testID="shift-list-screen">
      <ListHeader subtitle="Cash shifts of every tablet" title="Shifts" testIDPrefix="shifts" />
      <SafeAreaView edges={['left', 'right']} style={styles.body}>
        <DateFilterBar
          businessDate={screen.businessDate}
          isToday={screen.isToday}
          allDates={screen.allDates}
          canGoNext={screen.canGoNext}
          onPrevious={screen.previousDay}
          onNext={screen.nextDay}
          onToday={screen.showToday}
          onAllDates={screen.showAllDates}
          testIDPrefix="shifts"
        />
        <CardGrid
          items={screen.list.items}
          keyOf={shiftKey}
          renderItem={(shift) => <ShiftCard shift={shift} onPress={openShift} />}
          {...screen.list.grid}
          empty={empty}
          testID="shifts-grid"
        />
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
});
