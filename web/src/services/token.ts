/**
 * The one place the web app keeps its Sanctum token: `localStorage` under
 * `pos.token` (docs/api-contract.md → Web POS §B). The token is never logged.
 */
const TOKEN_KEY = 'pos.token';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode quota): the session lasts for this page only.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored.
  }
}
