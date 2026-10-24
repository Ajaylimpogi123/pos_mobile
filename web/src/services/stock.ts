/**
 * GET /api/v1/sync/stock (any user): an advisory stock snapshot for the Sell
 * badges. The only `/sync/*` endpoint a web terminal calls (Q-036).
 */
import { api } from '@/services/api';
import type { DataEnvelope, StockSnapshot } from '@/services/types';

export async function getStockSnapshot(): Promise<StockSnapshot> {
  const response = await api.get<DataEnvelope<StockSnapshot>>('/api/v1/sync/stock');
  return response.data;
}
