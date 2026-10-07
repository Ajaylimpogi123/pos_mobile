/**
 * TanStack Query setup (PROJECT_MEMORY §7.3: server data lives in TanStack
 * Query). HTTP still goes through the shared client in `@/services/api`; the
 * query client only caches, refetches and tracks mutations.
 */
import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/services/api';

/** Retries network failures, timeouts and 5xx; never 4xx (401/403/404/409/422 won't change on retry). */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.status !== null && error.status < 500) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** The app's query client, provided in the root layout. Cleared on sign-out. */
export const queryClient = createQueryClient();
