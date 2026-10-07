/** TanStack Query keys for customers. Everything lives under `['customers']`. */
const root = ['customers'] as const;

export const customerKeys = {
  all: root,
  lists: () => [...root, 'list'] as const,
  /** `search`: trimmed, debounced ('' = no filter). */
  list: (search: string) => [...root, 'list', { search }] as const,
  detail: (id: number) => [...root, 'detail', id] as const,
};
