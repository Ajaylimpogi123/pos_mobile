<?php

namespace App\Http\Requests\Purchasing;

use App\Models\PurchaseRequest;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * PATCH /api/v1/purchase-requests/{purchaseRequest} (the requester or `purchase.approve`):
 * partial `date_needed`, `remarks` and `items`. `items`, when sent, is the whole new set, updated
 * by `id`: an item with an `id` (one of this PR's) is changed in place, one without is added, and
 * a PR item missing from the set is removed. Only while no item has been decided (a 409 from
 * the action).
 */
class UpdatePurchaseRequestRequest extends FormRequest
{
    use PurchaseRequestItemRules;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->purchaseRequest()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'date_needed' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'remarks' => ['sometimes', 'nullable', 'string', 'max:500'],
            ...$this->itemRules(required: false, purchaseRequest: $this->purchaseRequest()),
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->resolveItems($validator)];
    }

    public function purchaseRequest(): PurchaseRequest
    {
        /** @var PurchaseRequest */
        return $this->route('purchaseRequest');
    }

    /**
     * The sent `date_needed` / `remarks` (only those sent; `remarks: ""` clears).
     *
     * @return array<string, string|null>
     */
    public function fields(): array
    {
        $fields = array_intersect_key($this->validated(), array_flip(['date_needed', 'remarks']));

        return array_map(fn ($value) => $value === '' ? null : $value, $fields);
    }

    public function hasItems(): bool
    {
        return array_key_exists('items', $this->validated());
    }
}
