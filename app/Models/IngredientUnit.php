<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One of an ingredient's own units: 1 `name` = `factor` × the ingredient's base unit
 * (e.g. Flour: `sack` = 25000 g, `cup` = 120 g).
 *
 * @property int $id
 * @property int $ingredient_id
 * @property string $name
 * @property string $factor Exact decimal string (up to 10 decimals)
 */
class IngredientUnit extends Model
{
    protected $fillable = ['name', 'factor'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'ingredient_id' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class)->withTrashed();
    }
}
