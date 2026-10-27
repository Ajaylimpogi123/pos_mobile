<?php

namespace App\Http\Requests\Tabs;

use App\Exceptions\ConflictException;
use App\Models\Tab;
use App\Models\User;
use App\Support\DineIn;
use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/tables/summary (Table Management → D; `report.view`). `403` without
 * `report.view`, then `409` while dine-in is off. No query parameters.
 */
class TablesSummaryRequest extends FormRequest
{
    /**
     * @throws ConflictException 409 while dine-in is off
     */
    public function authorize(): bool
    {
        $user = $this->user();

        if (! $user instanceof User || ! $user->can('viewSummary', Tab::class)) {
            return false;
        }

        DineIn::ensureEnabled($user);

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }
}
