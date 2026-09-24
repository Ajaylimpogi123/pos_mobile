<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Auth token lifetime
    |--------------------------------------------------------------------------
    |
    | Number of hours a device-bound Sanctum token issued by POST
    | /api/v1/auth/login stays valid. After this the client must log in again.
    |
    */

    'auth_token_ttl_hours' => (int) env('AUTH_TOKEN_TTL_HOURS', 24),

];
