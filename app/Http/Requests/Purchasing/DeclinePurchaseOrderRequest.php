<?php

namespace App\Http\Requests\Purchasing;

use App\Models\PurchaseOrder;
use Illuminate\Auth\Access\Response;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * POST /api/v1/purchase-orders/{purchaseOrder}/decline (`purchase.approve`, with the
 * self-approval rule as for approving, provisional Q-030): `{ reason }` (required, max 255).
 */
class DeclinePurchaseOrderRequest extends FormRequest
{
    public function authorize(): Response
    {
        /** @var PurchaseOrder $purchaseOrder */
        $purchaseOrder = $this->route('purchaseOrder');

        return Gate::forUser($this->user())->inspect('decline', $purchaseOrder);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:255'],
        ];
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }
}
