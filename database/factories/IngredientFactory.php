<?php

namespace Database\Factories;

use App\Models\Ingredient;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Ingredient>
 */
class IngredientFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => ucfirst(fake()->unique()->words(2, true)),
            'base_unit' => 'g',
            'image_path' => null,
            'is_active' => true,
        ];
    }

    /**
     * The ingredient's own units: `[name => factor]`, created after the ingredient.
     *
     * @param  array<string, string>  $units
     */
    public function withUnits(array $units): static
    {
        return $this->afterCreating(function (Ingredient $ingredient) use ($units) {
            foreach ($units as $name => $factor) {
                $ingredient->units()->create(['name' => $name, 'factor' => $factor]);
            }
        });
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => ['is_active' => false]);
    }
}
