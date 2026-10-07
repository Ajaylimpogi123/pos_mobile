<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Routes a category to a printer within a branch (Phase 4). At most one printer per
 * category and branch. Written only by App\Actions\Printing.
 *
 * @property int $id
 * @property int $branch_id
 * @property int $category_id
 * @property int $printer_id
 */
class PrintRoute extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'category_id' => 'integer',
            'printer_id' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Category, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Printer, $this>
     */
    public function printer(): BelongsTo
    {
        return $this->belongsTo(Printer::class)->withTrashed();
    }
}
