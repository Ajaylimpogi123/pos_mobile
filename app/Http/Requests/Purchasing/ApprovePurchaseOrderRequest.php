<?php

namespace App\Http\Requests\Purchasing;

use App\Models\PurchaseOrder;
use Illuminate\Auth\Access\Response;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

/**
 * POST /api/v1/purchase-orders/{purchaseOrder}/approve (`purchase.approve`, and on a PO you
 * created `purchase.approve_own`: `403 Someone else must approve your own request.`). No body.
 */
class ApprovePurchaseOrderRequest extends FormRequest
{
    public function authorize(): Response
    {
        /** @var PurchaseOrder $purchaseOrder */
        $purchaseOrder = $this->route('purchaseOrder');

        return Gate::forUser($this->user())->inspect('approve', $purchaseOrder);
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [];
    }
}
