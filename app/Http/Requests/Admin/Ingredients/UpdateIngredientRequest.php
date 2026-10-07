<?php

namespace App\Http\Requests\Admin\Ingredients;

use App\Models\Ingredient;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * PATCH /api/v1/admin/ingredients/{ingredient} (permission `product.manage`). Partial update;
 * `units`, when sent, replaces the set by `id` (see IngredientRules and SaveIngredientAction).
 */
class UpdateIngredientRequest extends FormRequest
{
    use IngredientRules;

    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->ingredient()) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->ingredientRules(partial: true, ingredient: $this->ingredient());
    }

    public function ingredient(): Ingredient
    {
        /** @var Ingredient */
        return $this->route('ingredient');
    }
}
