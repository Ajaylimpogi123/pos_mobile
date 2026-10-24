/**
 * Lets non-React code (the API client's 401 handler) navigate with React
 * Router. `NavigationBridge` (inside the router) registers the navigate function.
 */
type Navigate = (to: string, options?: { replace?: boolean }) => void;

let navigator: Navigate | null = null;

export function setNavigator(next: Navigate | null): void {
  navigator = next;
}

export function navigateTo(to: string, options?: { replace?: boolean }): void {
  navigator?.(to, options);
}
