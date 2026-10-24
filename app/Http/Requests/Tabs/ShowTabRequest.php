<?php

namespace App\Http\Requests\Tabs;

/**
 * GET /api/v1/tabs/{ulid} (`sale.create`). See TabRequest for the order of the checks.
 */
class ShowTabRequest extends TabRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }

    /**
     * A read sends no Idempotency-Key.
     *
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return $this->all();
    }
}
