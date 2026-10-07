<?php

namespace App\Http\Requests\Purchasing;

use App\Models\PurchaseRequest;
use App\Models\PurchaseRequestItem;
use Illuminate\Auth\Access\Response;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/purchase-requests/{purchaseRequest}/decisions (`purchase.approve`, and on your own
 * PR `purchase.approve_own`: otherwise `403 Someone else must approve your own request.`):
 * `{ decisions: [{ item_id, decision: approved|declined, reason? }] }` (1 to 100). Each `item_id`
 * is one of this PR's items, at most once. A `reason` (max 255) is required to decline:
 * `Give a reason for declining.`
 */
class DecidePurchaseRequestRequest extends FormRequest
{
    public const MESSAGE_REASON_REQUIRED = 'Give a reason for declining.';

    /**
     * Checked before validation (with the self-approval message).
     */
    public function authorize(): Response
    {
        return Gate::forUser($this->user())->inspect('decide', $this->purchaseRequest());
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'decisions' => ['required', 'array', 'min:1', 'max:100'],
            'decisions.*' => ['array'],
            'decisions.*.item_id' => [
                'required', 'integer', 'distinct',
                Rule::exists('purchase_request_items', 'id')->where('purchase_request_id', $this->purchaseRequest()->id),
            ],
            'decisions.*.decision' => ['required', 'string', Rule::in([PurchaseRequestItem::DECISION_APPROVED, PurchaseRequestItem::DECISION_DECLINED])],
            'decisions.*.reason' => [
                'nullable', 'string', 'max:255',
                'required_if:decisions.*.decision,'.PurchaseRequestItem::DECISION_DECLINED,
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['decisions.*.reason.required_if' => self::MESSAGE_REASON_REQUIRED];
    }

    public function purchaseRequest(): PurchaseRequest
    {
        /** @var PurchaseRequest */
        return $this->route('purchaseRequest');
    }

    /**
     * @return list<array{item_id: int, decision: string, reason: string|null}>
     */
    public function decisions(): array
    {
        return array_values(array_map(fn (array $decision) => [
            'item_id' => (int) $decision['item_id'],
            'decision' => (string) $decision['decision'],
            'reason' => isset($decision['reason']) && $decision['reason'] !== '' ? (string) $decision['reason'] : null,
        ], (array) $this->validated('decisions')));
    }
}
