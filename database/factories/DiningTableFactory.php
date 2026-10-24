<?php

namespace Database\Factories;

use App\Models\Branch;
use App\Models\DiningTable;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DiningTable>
 */
class DiningTableFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'branch_id' => Branch::factory(),
            'name' => (string) fake()->unique()->numberBetween(1, 9999),
            'area' => null,
            'seats' => 4,
            'sort_order' => 0,
            'is_active' => true,
        ];
    }

    /**
     * Place the table in the given branch.
     */
    public function forBranch(Branch $branch): static
    {
        return $this->state(fn (array $attributes) => ['branch_id' => $branch->id]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => ['is_active' => false]);
    }
}
