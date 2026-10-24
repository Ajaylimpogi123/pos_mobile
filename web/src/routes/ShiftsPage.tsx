/**
 * Shifts (Shifts & Reporting → Screens, Web POS §G W2): this terminal's shift
 * (`shift.open` / `shift.close`: open, cash in/out, the live X-read, close and
 * the Z-read), then the shift history (`report.zread`). Each part shows only
 * to the users who may use it; the logic lives in the hooks.
 *
 * A history row opens the shift's detail: a right sheet at ≥ 1280 px and a
 * full page below (MASTER §6), with the page's content kept mounted underneath.
 */
import { useCallback, useState } from 'react';

import { PageBand } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { CurrentShiftPanel } from '@/components/shifts/CurrentShiftPanel';
import { ShiftDetailSheet, type ShiftDetailIntent } from '@/components/shifts/ShiftDetailSheet';
import { ShiftHistory } from '@/components/shifts/ShiftHistory';
import { useDetailMode } from '@/hooks/useMediaQuery';
import { registeredDevice, useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';
import { businessDateAt } from '@pos/core/businessDay';

export function ShiftsPage() {
  useShellHeader('Shifts');
  const user = useSessionStore((state) => state.user);
  const device = registeredDevice(useSessionStore((state) => state.device));
  const [today] = useState(() => (user ? businessDateAt(Date.now(), user.branch.timezone, user.branch.day_start_time) : ''));

  const terminalShift = hasAnyPermission(user, [PERMISSIONS.shiftOpen, PERMISSIONS.shiftClose]);
  const history = hasPermission(user, PERMISSIONS.reportZread);

  const [selected, setSelected] = useState<{ ulid: string; intent: ShiftDetailIntent } | null>(null);
  const openShift = useCallback((ulid: string, intent: ShiftDetailIntent) => setSelected({ ulid, intent }), []);
  const closeShift = useCallback(() => setSelected(null), []);
  const detailMode = useDetailMode();
  const showPage = detailMode === 'page' && selected !== null;

  return (
    <>
      <div hidden={showPage}>
        <PageBand title="Shifts" businessDate={today} note={device ? `Terminal ${device.code}` : null}>
          {terminalShift ? <CurrentShiftPanel /> : null}
          {history ? <ShiftHistory today={today} onOpen={openShift} /> : null}
        </PageBand>
      </div>
      {history ? <ShiftDetailSheet mode={detailMode} ulid={selected?.ulid ?? null} intent={selected?.intent} onClose={closeShift} /> : null}
    </>
  );
}
