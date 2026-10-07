/**
 * Feature: Printing (Phase 4): receipt settings of the caller's branch
 * (permission `settings.manage`). One function per contract endpoint.
 */
import { api } from '@/services/api';
import type { BranchSettings, BranchSettingsUpdateRequest, DataEnvelope } from '@/services/types';

const SETTINGS = '/api/v1/admin/settings';

/** GET /api/v1/admin/settings: defaults are filled in (`updated_at` is null until first saved). */
export async function getBranchSettings(): Promise<BranchSettings> {
  const response = await api.get<DataEnvelope<BranchSettings>>(SETTINGS);
  return response.data;
}

/** PATCH /api/v1/admin/settings: partial. */
export async function updateBranchSettings(body: BranchSettingsUpdateRequest): Promise<BranchSettings> {
  const response = await api.patch<DataEnvelope<BranchSettings>>(SETTINGS, body);
  return response.data;
}
