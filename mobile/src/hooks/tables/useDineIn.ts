import { usePrintingStore } from '@/stores/printing';

/**
 * Dine-in Tables & Tabs §A: the branch's `dine_in_enabled` and
 * `service_charge_bps`, from the cached `GET /print-config` settings (synced
 * at sign-in, on "Sync now" and after Settings is saved). Off until the config
 * says otherwise, so nothing changes on a branch that doesn't use it.
 */
export function useDineInEnabled(): boolean {
  return usePrintingStore((state) => state.config?.settings.dine_in_enabled === true);
}

/** The branch's service charge in basis points (0 = none). */
export function useServiceChargeBps(): number {
  return usePrintingStore((state) => state.config?.settings.service_charge_bps ?? 0);
}
