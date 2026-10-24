import { create } from 'zustand';

/**
 * Toasts (MASTER §3 / §6): short confirmations that need no action: save
 * success, "Sent to kitchen", "Printed", "Copied". Errors that need an
 * action (print failed with Retry, 409 conflicts, offline) stay banners or
 * dialogs. One toast shows at a time; a new one replaces it.
 */
export type ToastVariant = 'success' | 'error' | 'info';

export type ToastMessage = {
  id: number;
  message: string;
  variant: ToastVariant;
};

type ToastState = {
  toast: ToastMessage | null;
  show: (message: string, variant?: ToastVariant) => void;
  /** Hides the toast with this id (a newer one stays). */
  hide: (id: number) => void;
  /** Test helper: back to the initial state. */
  reset: () => void;
};

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toast: null,
  show: (message, variant = 'success') => {
    nextId += 1;
    set({ toast: { id: nextId, message, variant } });
  },
  hide: (id) => {
    if (get().toast?.id === id) set({ toast: null });
  },
  reset: () => set({ toast: null }),
}));

/** Shows a toast from anywhere (hooks, actions). */
export function showToast(message: string, variant: ToastVariant = 'success'): void {
  useToastStore.getState().show(message, variant);
}
