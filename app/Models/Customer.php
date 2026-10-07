<?php

namespace App\Models;

use Database\Factories\CustomerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Str;

/**
 * An optional customer record for a sale. Global master data (not branch-scoped),
 * soft-deleted. `last_name_sort` is a DB-generated column used only for ordering.
 *
 * @property int $id
 * @property string $first_name
 * @property string|null $last_name
 * @property string|null $contact
 * @property string|null $email
 * @property string|null $notes
 * @property-read string $full_name
 */
#[Fillable(['first_name', 'last_name', 'contact', 'email', 'notes'])]
class Customer extends Model
{
    /** @use HasFactory<CustomerFactory> */
    use HasFactory, SoftDeletes;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'last_name' => null,
        'contact' => null,
        'email' => null,
        'notes' => null,
    ];

    /**
     * `first_name` + " " + `last_name`, trimmed.
     *
     * @return Attribute<string, never>
     */
    protected function fullName(): Attribute
    {
        return Attribute::get(fn () => trim($this->first_name.' '.($this->last_name ?? '')));
    }

    /**
     * Emails are stored lowercased and trimmed. They are not unique (families share emails).
     *
     * @return Attribute<string|null, string|null>
     */
    protected function email(): Attribute
    {
        return Attribute::make(
            set: fn (?string $value) => $value === null ? null : Str::lower(trim($value)),
        );
    }
}
