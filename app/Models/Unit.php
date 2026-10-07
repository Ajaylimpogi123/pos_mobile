<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A unit of the read-only catalog (Ingredients, Recipes & Purchasing → A. Units), seeded by
 * its migration. 1 `code` = `factor_to_base` × the dimension's base unit (`g`, `mL`, `pc`),
 * exactly.
 *
 * @property int $id
 * @property string $code
 * @property string $name
 * @property string $dimension `mass`, `volume` or `count`
 * @property string $factor_to_base Exact decimal string
 * @property int $sort_order
 */
class Unit extends Model
{
    public const DIMENSION_MASS = 'mass';

    public const DIMENSION_VOLUME = 'volume';

    public const DIMENSION_COUNT = 'count';

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
        ];
    }
}
