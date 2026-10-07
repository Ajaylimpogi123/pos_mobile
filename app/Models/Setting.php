<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One saved branch setting (`key` → JSON `value`). A key with no row uses its default;
 * read settings through App\Support\BranchSettings, which fills the defaults in and
 * types the values. Written only by App\Actions\Printing\UpdateBranchSettingsAction.
 *
 * @property int $id
 * @property int $branch_id
 * @property string $key
 * @property mixed $value
 */
#[Fillable(['branch_id', 'key'])]
class Setting extends Model
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
            'value' => 'json',
        ];
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
