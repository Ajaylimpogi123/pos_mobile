<?php

namespace App\Http\Requests\Customers;

use App\Http\Requests\CursorListRequest;
use App\Models\Customer;

/**
 * GET /api/v1/customers (any authenticated user).
 */
class ListCustomersRequest extends CursorListRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', Customer::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }
}
