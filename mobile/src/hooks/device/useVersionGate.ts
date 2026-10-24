import { useDiagnosticsStore } from '@/stores/diagnostics';
import { useOfflineStore } from '@/stores/offline';
import { dismissUpdate } from '@/sync/deviceHealth';
import { appVersion } from '@/utils/appVersion';
import { versionStatus, type VersionStatus } from '@pos/core/errors/version';

/**
 * Hardening & Pilot §D, for the screens: this app's version against the
 * server's `min_version` / `latest_version`.
 * - `update_required` → the blocking "Update required" screen (the outbox and
 *   error queue keep syncing behind it; `salesToSend` is shown).
 * - `update_available` → a dismissible banner, once per `latest_version`.
 */
export function useVersionGate() {
  const info = useDiagnosticsStore((state) => state.versionInfo);
  const dismissed = useDiagnosticsStore((state) => state.dismissedUpdateVersion);
  const salesToSend = useOfflineStore((state) => state.pending + state.needsAttention);
  const current = appVersion();
  const status: VersionStatus = info ? versionStatus(current, info) : 'up_to_date';
  const showBanner =
    status === 'update_available' && info !== null && dismissed !== undefined && dismissed !== info.latest_version;

  return {
    current,
    info,
    status,
    salesToSend,
    showBanner,
    dismissBanner: () => {
      if (info) dismissUpdate(info.latest_version);
    },
  };
}
