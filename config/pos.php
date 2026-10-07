<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Auth token lifetime
    |--------------------------------------------------------------------------
    |
    | Number of hours a Sanctum token (named `mobile-app`) issued by POST
    | /api/v1/auth/login stays valid. After this the client must log in again.
    |
    */

    'auth_token_ttl_hours' => (int) env('AUTH_TOKEN_TTL_HOURS', 24),

    /*
    |--------------------------------------------------------------------------
    | Catalogue image disk
    |--------------------------------------------------------------------------
    |
    | The filesystem disk (see config/filesystems.php) that stores category and
    | product images. `public` (local, served through the public/storage link)
    | in development; an S3-compatible disk in production. The disk must be able
    | to produce an absolute URL for a stored path.
    |
    */

    'catalog_image_disk' => env('CATALOG_IMAGE_DISK', 'public'),

    /*
    |--------------------------------------------------------------------------
    | Low margin threshold
    |--------------------------------------------------------------------------
    |
    | Products whose margin (in basis points, see App\Support\Margin) is below
    | this value are "low margin" on the dashboard. 3000 = 30.00%. Fixed by the
    | Phase 1c contract; deliberately not an env value.
    |
    */

    'low_margin_threshold_bps' => 3000,

    /*
    |--------------------------------------------------------------------------
    | VAT rate
    |--------------------------------------------------------------------------
    |
    | Philippine VAT, included in every VAT-able price, in basis points
    | (1200 = 12.00%). Used by the sale pricing (App\Support\Sales\SaleCalculator),
    | which rounds VAT once per order. Fixed by the Phase 3 contract; deliberately
    | not an env value.
    |
    */

    'vat_rate_bps' => 1200,

    /*
    |--------------------------------------------------------------------------
    | Senior Citizen / PWD discount rate
    |--------------------------------------------------------------------------
    |
    | The Senior Citizen (RA 9994) and PWD (RA 10754) discount on the eligible
    | part of a sale, in basis points (2000 = 20.00%). Used by the sale pricing
    | (App\Support\Sales\SaleCalculator, steps A–E). Fixed by the SC/PWD
    | contract; deliberately not an env value.
    |
    */

    'sc_pwd_discount_bps' => 2000,

    /*
    |--------------------------------------------------------------------------
    | Dev printer host
    |--------------------------------------------------------------------------
    |
    | Local development only (Phase 4). When set, DevSeeder adds the Counter
    | (port 9100), Kitchen (9101) and Bar (9102) printers to MAIN at this host,
    | e.g. the PC running `npm run fake-printer` in mobile/. When empty, no
    | printers are seeded.
    |
    */

    'dev_printer_host' => env('DEV_PRINTER_HOST') ?: null,

];
