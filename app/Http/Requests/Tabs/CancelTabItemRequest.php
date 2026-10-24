<?php

namespace App\Http\Requests\Tabs;

use App\Models\TabItem;
use Illuminate\Contracts\Validation\ValidationRule;
use LogicException;

/**
 * POST /api/v1/tabs/{ulid}/items/{id}/cancel (`sale.create`; idempotent with a key the app
 * makes when the dialog opens). After TabRequest's checks, a line that isn't on this tab is a
 * `404`. Body: `qty` (1 … `remaining_qty`), `reason` (required, max 255) and `authorization`
 * (nullable `{ user_id, pin }`: a manager's approval when the caller lacks `sale.void`).
 */
class CancelTabItemRequest extends TabRequest
{
    private ?TabItem $item = null;

    public function authorize(): bool
    {
        if (! parent::authorize()) {
            return false;
        }

        $this->item = TabItem::query()
            ->where('tab_id', $this->tab()->id)
            ->whereKey((int) $this->route('id'))
            ->firstOrFail();

        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'qty' => ['required', 'integer', 'min:1', 'max:'.max(0, $this->item()->remainingQty())],
            'reason' => ['required', 'string', 'max:255'],
            'authorization' => ['sometimes', 'nullable', 'array', 'required_array_keys:user_id,pin'],
            'authorization.user_id' => ['sometimes', 'required', 'integer'],
            'authorization.pin' => ['sometimes', 'required', 'string', 'regex:/^\d{4,6}$/D'],
        ];
    }

    /**
     * The tab line of the `{id}` route.
     */
    public function item(): TabItem
    {
        return $this->item ?? throw new LogicException('The item is resolved by authorize().');
    }
}
