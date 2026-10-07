/** A ULID from a route param (the first one of an array), or `null` when it isn't one. */
export function parseRouteUlid(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(raw) ? raw.toUpperCase() : null;
}

/** A positive integer id from a route param (`"7"` → 7), or `null` for anything else. */
export function parseRouteId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d{0,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}
