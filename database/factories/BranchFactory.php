<?php

namespace Database\Factories;

use App\Models\Branch;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Branch>
 */
class BranchFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->city().' Branch',
            'code' => strtoupper(fake()->unique()->bothify('BR###??')),
            'timezone' => 'Asia/Manila',
            'address' => fake()->address(),
            'tin' => null,
            'day_start_time' => '04:00:00',
            'is_active' => true,
        ];
    }
}
