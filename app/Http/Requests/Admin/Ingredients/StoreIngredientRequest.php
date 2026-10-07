<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Models\Ingredient;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/admin/ingredients (permission `product.manage`). See IngredientRules.
 */
class StoreIngredientRequest extends FormRequest
{
    use IngredientRules;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('create', Ingredient::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->ingredientRules(partial: false);
    }
}
