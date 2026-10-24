/**
 * The terminal's name for `POST /devices/register` (Web POS §C):
 * `Web · <browser> on <OS>`, at most 60 characters. Read from the user agent;
 * unknown parts fall back to "Browser" / "Unknown OS".
 */
const MAX_NAME = 60;

function browserOf(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function osOf(ua: string): string {
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

export function terminalName(userAgent: string = navigator.userAgent): string {
  return `Web · ${browserOf(userAgent)} on ${osOf(userAgent)}`.slice(0, MAX_NAME);
}

const VERSION_PATTERNS: readonly [string, RegExp][] = [
  ['Edge', /Edg\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Firefox', /Firefox\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Safari', /Version\/(\d+).*Safari\//],
];

/**
 * Hardening & Pilot §I `os_version`: the browser name and major version
 * (`Chrome 141`), at most 20 characters; just the name when the version is unknown.
 */
export function browserVersion(userAgent: string = navigator.userAgent): string {
  const name = browserOf(userAgent);
  const pattern = VERSION_PATTERNS.find(([label]) => label === name)?.[1];
  const major = pattern?.exec(userAgent)?.[1];
  return (major ? `${name} ${major}` : name).slice(0, 20);
}
