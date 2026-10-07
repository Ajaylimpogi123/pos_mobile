<?php

namespace App\Models;

use Database\Factories\SupplierFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A supplier (Ingredients, Recipes & Purchasing → C). Global master data, soft-deleted.
 *
 * @property int $id
 * @property string $name
 * @property string|null $contact_person
 * @property string|null $contact_number
 * @property string|null $email
 * @property string|null $address
 * @property bool $is_active
 */
#[Fillable(['name', 'contact_person', 'contact_number', 'email', 'address', 'is_active'])]
class Supplier extends Model
{
    /** @use HasFactory<SupplierFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'contact_person' => null,
        'contact_number' => null,
        'email' => null,
        'address' => null,
        'is_active' => true,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
