/**
 * Feature: Ingredients, Recipes & Purchasing §A: the unit catalog (seeded,
 * read-only, any authenticated user), through the shared client.
 */
import { api } from '@/services/api';
import type { Unit, UnitListResponse } from '@/services/types';

/** GET /api/v1/units → every catalog unit with its exact `factor_to_base` (Q-025: not paginated). */
export async function listUnits(): Promise<Unit[]> {
  const response = await api.get<UnitListResponse>('/api/v1/units');
  return response.data;
}
