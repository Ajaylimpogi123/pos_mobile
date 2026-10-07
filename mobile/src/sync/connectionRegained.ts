/**
 * "Connection regained" (Offline Sales hardening): when expo-network reports
 * a connection again, **or** the server answers again after an outage, every
 * sync runs at once, so the offline sales go up and the menu, the printer
 * settings and the stock cache aren't stale for up to 5 minutes. Each runner
 * is single-flight: a trigger during a run joins it.
 */
import { requestCatalogueSync } from '@/sync/catalogueSync';
import { requestOutboxSync } from '@/sync/outboxSync';
import { requestPrintConfigSync } from '@/sync/printConfigSync';
import { requestStockSync } from '@/sync/stockSync';

export function requestConnectionRegainedSyncs(): void {
  void requestOutboxSync();
  void requestCatalogueSync();
  void requestPrintConfigSync();
  void requestStockSync();
}
