/**
 * The web build's version (Hardening & Pilot §I): `web/package.json` `version`,
 * injected by Vite at build time as `__APP_VERSION__` (vite.config.ts `define`).
 * Sent as `app_version` (max 20) on registration, heartbeats and error reports.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__.slice(0, 20);
