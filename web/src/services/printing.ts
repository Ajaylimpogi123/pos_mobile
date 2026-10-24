/**
 * Printing endpoints the web terminal uses (Printing Phase 4, Web POS §D):
 * the print config, and the print-job queue the print agent drains.
 * Every job the server returns is noted in the terminal's print-job log
 * (Hardening & Pilot §I: printer health, the print-agent check, failed prints).
 */
import { recordPrintJobs } from '@/diagnostics/printJobLog';
import { api, buildQuery } from '@/services/api';
import type { DataEnvelope, PrintConfig, PrintJob, PrintJobCreateRequest } from '@/services/types';

/** GET /api/v1/print-config → the branch, its settings and every non-deleted printer. */
export async function getPrintConfig(): Promise<PrintConfig> {
  const response = await api.get<DataEnvelope<PrintConfig>>('/api/v1/print-config');
  return response.data;
}

/**
 * POST /api/v1/print-jobs → 201 (new) or 200 (a replay of the same `ulid`, or
 * a first print the server already has). `409 "Register this terminal first."`
 * when the token isn't bound to a device.
 */
export async function createPrintJob(body: PrintJobCreateRequest): Promise<PrintJob> {
  const response = await api.post<DataEnvelope<PrintJob>>('/api/v1/print-jobs', body);
  recordPrintJobs([response.data]);
  return response.data;
}

/** GET /api/v1/print-jobs?ulids[]=…: up to 50; unknown ulids are left out. */
export async function listPrintJobs(ulids: readonly string[]): Promise<PrintJob[]> {
  const response = await api.get<DataEnvelope<PrintJob[]>>(`/api/v1/print-jobs${buildQuery({ ulids })}`);
  recordPrintJobs(response.data);
  return response.data;
}

/** POST /api/v1/print-jobs/{ulid}/retry: only a `failed` job (else 409). */
export async function retryPrintJob(ulid: string): Promise<PrintJob> {
  const response = await api.post<DataEnvelope<PrintJob>>(`/api/v1/print-jobs/${encodeURIComponent(ulid)}/retry`);
  recordPrintJobs([response.data]);
  return response.data;
}
