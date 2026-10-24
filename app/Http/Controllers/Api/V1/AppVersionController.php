<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\AppVersionResource;
use App\Support\AppVersion;

/**
 * The app versions the server announces (Hardening & Pilot → C).
 */
class AppVersionController extends Controller
{
    /**
     * GET /api/v1/app-version (no auth; 60/min per IP)
     */
    public function show(): AppVersionResource
    {
        return new AppVersionResource(AppVersion::info());
    }
}
