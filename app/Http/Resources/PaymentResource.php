<?php

namespace App\Http\Resources;

use App\Models\Payment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A payment of the contract's `Order` (`payments[]`, in the order sent).
 *
 * @mixin Payment
 */
class PaymentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Payment $payment */
        $payment = $this->resource;

        return [
            'method' => $payment->method,
            'amount_cents' => $payment->amount_cents,
            'tendered_cents' => $payment->tendered_cents,
            'change_cents' => $payment->change_cents,
            'reference_no' => $payment->reference_no,
        ];
    }
}
