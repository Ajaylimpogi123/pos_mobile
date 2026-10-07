/**
 * Test-only window size store behind the `useWindowDimensions` mock in
 * jest.setup.ts. `setWindowSize()` notifies subscribers, so mounted
 * components re-render exactly as they would on a real rotation.
 * Never import from app code.
 */
type Size = { width: number; height: number };
type Listener = () => void;

/** The primary device: a 10" tablet in landscape. */
export const DEFAULT_WINDOW: Size = { width: 1280, height: 800 };

let current = { ...DEFAULT_WINDOW, scale: 2, fontScale: 1 };
const listeners = new Set<Listener>();

export function getWindowSize() {
  return current;
}

export function subscribeWindowSize(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes the mocked window size and notifies mounted components. Wrap in `act()`. */
export function setWindowSize(width: number, height: number): void {
  current = { width, height, scale: 2, fontScale: 1 };
  listeners.forEach((listener) => listener());
}

export function resetWindowSize(): void {
  setWindowSize(DEFAULT_WINDOW.width, DEFAULT_WINDOW.height);
}
