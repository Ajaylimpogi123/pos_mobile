/**
 * Feature: Printing (Phase 4): GET /api/v1/print-config (any signed-in user).
 * The device caches it in SQLite (`@/sync/printConfigSync`), so printing also
 * works while the server can't be reached.
 */
import { api } from '@/services/api';
import type { DataEnvelope, PrintConfig } from '@/services/types';

/** GET /api/v1/print-config → `data`: the branch, its settings and every non-deleted printer. */
export async function getPrintConfig(): Promise<PrintConfig> {
  const response = await api.get<DataEnvelope<PrintConfig>>('/api/v1/print-config');
  return response.data;
}
