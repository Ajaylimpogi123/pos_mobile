import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { printingKeys } from '@/hooks/printers/queryKeys';
import { tableKeys } from '@/hooks/tables/queryKeys';
import { getErrorMessage, isApiValidationError } from '@/services/api';
import { updateBranchSettings } from '@/services/settings';
import type { BranchSettings, BranchSettingsUpdateRequest } from '@/services/types';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { showToast } from '@/stores/toast';
import { SERVICE_CHARGE_MAX_BPS } from '@pos/core/sale/serviceCharge';

export const DINE_IN_SAVED_MESSAGE = 'Dine-in settings saved.';
export const NOTHING_TO_SAVE_MESSAGE = 'Nothing changed.';
export const SERVICE_CHARGE_RANGE_MESSAGE = 'Enter a percentage from 0 to 20, like 10 or 12.5.';

/** Table Management §A (TM2): `reservation_hold_minutes` is `0–240`. */
export const HOLD_MINUTES_MAX = 240;
export const HOLD_MINUTES_RANGE_MESSAGE = `Enter 0 to ${HOLD_MINUTES_MAX} minutes.`;

/** "60" → 60, "" → `null`; `null` unless a whole number of minutes from 0 to 240. */
export function parseHoldMinutes(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const minutes = Number(trimmed);
  return minutes <= HOLD_MINUTES_MAX ? minutes : null;
}

/** "10" → 1000, "12.5" → 1250, "" → 0; `null` when it isn't a percentage from 0 to 20 with up to 2 decimals. No floats. */
export function parseServiceChargePercent(text: string): number | null {
  const trimmed = text.trim().replace(/%$/, '').trim();
  if (trimmed === '') return 0;
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps <= SERVICE_CHARGE_MAX_BPS ? bps : null;
}

/** 1000 → "10", 1250 → "12.5", 0 → "0". */
export function serviceChargeText(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

export type DineInErrors = { enabled: string | null; serviceCharge: string | null; holdMinutes: string | null };

const NO_ERRORS: DineInErrors = { enabled: null, serviceCharge: null, holdMinutes: null };

/**
 * Settings → **Dine-in** (`settings.manage`; Dine-in Tables & Tabs §A and
 * §I): the on/off switch and the service charge %, saved with PATCH
 * /api/v1/admin/settings (changed fields only). Turning it off while bills are
 * open answers `409 "Close the 3 open bills first."`, shown in the banner.
 * Saving syncs the print config, which carries both settings to Sell.
 * Table Management (TM2) adds **Hold reserved tables from** (minutes).
 */
export function useDineInSettingsForm(initial: BranchSettings) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.dine_in_enabled);
  const [percent, setPercent] = useState(() => serviceChargeText(initial.service_charge_bps));
  const [holdMinutes, setHoldMinutes] = useState(() => String(initial.reservation_hold_minutes));
  const [errors, setErrors] = useState<DineInErrors>(NO_ERRORS);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  function touched() {
    setErrors(NO_ERRORS);
    setNotice(null);
    setBanner(null);
  }

  async function submit() {
    if (inFlight.current) return;
    touched();
    const bps = parseServiceChargePercent(percent);
    if (bps === null) {
      setErrors({ ...NO_ERRORS, serviceCharge: SERVICE_CHARGE_RANGE_MESSAGE });
      return;
    }
    const hold = parseHoldMinutes(holdMinutes);
    if (hold === null) {
      setErrors({ ...NO_ERRORS, holdMinutes: HOLD_MINUTES_RANGE_MESSAGE });
      return;
    }
    const changes: BranchSettingsUpdateRequest = {};
    if (enabled !== saved.dine_in_enabled) changes.dine_in_enabled = enabled;
    if (bps !== saved.service_charge_bps) changes.service_charge_bps = bps;
    if (hold !== saved.reservation_hold_minutes) changes.reservation_hold_minutes = hold;
    if (Object.keys(changes).length === 0) {
      setNotice(NOTHING_TO_SAVE_MESSAGE);
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    try {
      const next = await updateBranchSettings(changes);
      setSaved(next);
      setEnabled(next.dine_in_enabled);
      setPercent(serviceChargeText(next.service_charge_bps));
      setHoldMinutes(String(next.reservation_hold_minutes));
      client.setQueryData(printingKeys.settings(), next);
      void client.invalidateQueries({ queryKey: tableKeys.all });
      void requestPrintConfigSync();
      // MASTER §6: save success is a toast.
      showToast(DINE_IN_SAVED_MESSAGE);
    } catch (error) {
      if (isApiValidationError(error)) {
        const mapped: DineInErrors = {
          enabled: error.firstError('dine_in_enabled'),
          serviceCharge: error.firstError('service_charge_bps'),
          holdMinutes: error.firstError('reservation_hold_minutes'),
        };
        if (mapped.enabled || mapped.serviceCharge || mapped.holdMinutes) setErrors(mapped);
        else setBanner(error.message);
      } else {
        setBanner(getErrorMessage(error));
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return {
    enabled,
    percent,
    holdMinutes,
    errors,
    banner,
    notice,
    submitting,
    setEnabled: (value: boolean) => {
      setEnabled(value);
      touched();
    },
    setPercent: (text: string) => {
      setPercent(text);
      touched();
    },
    setHoldMinutes: (text: string) => {
      setHoldMinutes(text);
      touched();
    },
    submit: () => void submit(),
  };
}
