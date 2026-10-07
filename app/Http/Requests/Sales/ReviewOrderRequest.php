<?php

namespace App\Http\Requests\Sales;

use App\Models\Order;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/orders/{ulid}/review (permission `order.review`, Phase 5).
 *
 * 403 without `order.review` (checked before validation); the order's visibility (404)
 * and whether it needs review (409) are checked by the controller and the action.
 */
class ReviewOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('review', Order::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'note' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
