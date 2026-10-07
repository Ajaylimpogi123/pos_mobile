<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UnitResource;
use App\Support\Units\UnitConversion;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The unit catalog (Ingredients, Recipes & Purchasing → A): any authenticated user, seeded and
 * read-only, in its display order (mass, volume, count). Not paginated: it is a fixed list of 17.
 */
class UnitController extends Controller
{
    /**
     * GET /api/v1/units
     */
    public function index(): AnonymousResourceCollection
    {
        return UnitResource::collection(UnitConversion::catalog());
    }
}
