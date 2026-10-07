<?php

namespace Database\Factories;

use App\Models\Category;
use App\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $price = fake()->numberBetween(20, 500) * 100;

        return [
            'category_id' => Category::factory(),
            'sku' => null,
            'name' => ucfirst(fake()->unique()->words(3, true)),
            'description' => null,
            'price_cents' => $price,
            'cost_cents' => intdiv($price * 45, 100),
            'is_vatable' => true,
            'is_available' => true,
            'stock_mode' => Product::STOCK_NONE,
            'sort_order' => 0,
            'image_path' => null,
        ];
    }

    /**
     * Place the product in the given category.
     */
    public function forCategory(Category $category): static
    {
        return $this->state(fn (array $attributes) => [
            'category_id' => $category->id,
        ]);
    }

    /**
     * Give the product a stock mode (`own`, `recipe` or `none`; Ingredients, Recipes & Purchasing → J).
     */
    public function stockMode(string $mode): static
    {
        return $this->state(fn (array $attributes) => [
            'stock_mode' => $mode,
        ]);
    }

    /**
     * Indicate that the product is shown as "Unavailable" and cannot be sold.
     */
    public function unavailable(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_available' => false,
        ]);
    }
}
