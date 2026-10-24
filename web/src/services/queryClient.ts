import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/services/api';

/**
 * The app's TanStack Query client. A 4xx is an answer, never retried; a
 * network error or 5xx is retried once.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status !== null && error.status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
