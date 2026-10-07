<?php

namespace App\Http\Requests\Purchasing;

use App\Models\PurchaseRequest;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * DELETE /api/v1/purchase-requests/{purchaseRequest} (the requester or `purchase.approve`): a soft
 * cancel. No body.
 */
class CancelPurchaseRequestRequest extends FormRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        /** @var PurchaseRequest $purchaseRequest */
        $purchaseRequest = $this->route('purchaseRequest');

        return $this->user()?->can('update', $purchaseRequest) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [];
    }
}
