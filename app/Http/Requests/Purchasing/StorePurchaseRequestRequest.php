<?php

namespace App\Http\Requests\Purchasing;

use App\Http\Requests\Concerns\ValidatesIdempotencyKey;
use App\Models\PurchaseRequest;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * POST /api/v1/purchase-requests (permission `purchase.request`; idempotent, `Idempotency-Key`
 * = the body's `ulid`): `{ ulid, date_needed?, remarks?, items: [...] (1..100) }` with the item
 * rules of PurchaseRequestItemRules. `remarks` is at most 500 characters (provisional, Q-030).
 */
class StorePurchaseRequestRequest extends FormRequest
{
    use PurchaseRequestItemRules;
    use ValidatesIdempotencyKey;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', PurchaseRequest::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'date_needed' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:500'],
            ...$this->itemRules(required: true),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->resolveItems($validator)];
    }

    public function dateNeeded(): ?string
    {
        $value = $this->validated('date_needed');

        return $value === null ? null : (string) $value;
    }

    public function remarks(): ?string
    {
        $value = $this->validated('remarks');

        return $value === null || $value === '' ? null : (string) $value;
    }
}
