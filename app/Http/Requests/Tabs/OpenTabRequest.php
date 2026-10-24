<?php

namespace App\Http\Requests\Tabs;

use App\Exceptions\ConflictException;
use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\Tab;
use App\Models\User;
use App\Support\DineIn;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/tabs (`sale.create`; idempotent: `Idempotency-Key` = the body's `ulid`).
 *
 * `403` without `sale.create`, then `409` while dine-in is off, then the field rules:
 * `ulid`, `table_id` (an active table of the caller's branch), `guests` (1–99, default the
 * table's `seats`), `customer_id` (nullable, an existing customer) and `notes` (max 255).
 */
class OpenTabRequest extends FormRequest
{
    use ValidatesIdempotencyKey;

    /**
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('create', Tab::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var User $user */
        $user = $this->user();

        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'table_id' => ['bail', 'required', 'integer', TabRules::activeTable((int) $user->branch_id)],
            'guests' => ['sometimes', 'integer', 'min:1', 'max:'.TabRules::MAX_GUESTS],
            'customer_id' => ['sometimes', 'nullable', 'integer', TabRules::customer()],
            'notes' => ['sometimes', 'nullable', 'string', 'max:'.TabRules::MAX_NOTES],
        ];
    }
}
