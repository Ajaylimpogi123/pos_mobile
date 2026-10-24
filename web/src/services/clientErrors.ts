/**
 * POST /api/v1/client-errors (Hardening & Pilot §B). Auth is optional: the
 * token goes along when there is one, so the user and terminal are recorded.
 */
import { api } from '@/services/api';
import type { ClientErrorsAccepted, ClientErrorsRequest, DataEnvelope } from '@/services/types';

export const CLIENT_ERRORS_PATH = '/api/v1/client-errors';

/** → 202 `{accepted, duplicates}`. 422 malformed body; 429 throttled (keep and retry later). */
export async function sendClientErrors(body: ClientErrorsRequest): Promise<ClientErrorsAccepted> {
  const response = await api.post<DataEnvelope<ClientErrorsAccepted>>(CLIENT_ERRORS_PATH, body);
  return response.data;
}
