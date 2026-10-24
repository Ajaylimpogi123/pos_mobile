<?php

namespace App\Support;

/**
 * The app versions the server announces (Hardening & Pilot → C, `AppVersionInfo`), from
 * `APP_MIN_VERSION`, `APP_LATEST_VERSION` and `APP_UPDATE_URL` (config `pos.app_version`),
 * and the semver `major.minor.patch` compare.
 */
final class AppVersion
{
    /**
     * @return array{min_version: string, latest_version: string, update_url: string|null}
     */
    public static function info(): array
    {
        $url = config('pos.app_version.update_url');

        return [
            'min_version' => (string) config('pos.app_version.min', '1.0.0'),
            'latest_version' => (string) config('pos.app_version.latest', '1.0.0'),
            'update_url' => is_string($url) && $url !== '' ? $url : null,
        ];
    }

    /**
     * -1, 0 or 1 comparing `major.minor.patch` (a missing part is 0; anything after the patch,
     * such as `-beta` or `+build`, is ignored). Null when either side isn't a version.
     */
    public static function compare(?string $a, ?string $b): ?int
    {
        $left = self::parse($a);
        $right = self::parse($b);

        return $left === null || $right === null ? null : $left <=> $right;
    }

    /**
     * @return array{int, int, int}|null
     */
    private static function parse(?string $version): ?array
    {
        if ($version === null || preg_match('/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/', trim($version), $m) !== 1) {
            return null;
        }

        return [(int) $m[1], (int) ($m[2] ?? 0), (int) ($m[3] ?? 0)];
    }
}
