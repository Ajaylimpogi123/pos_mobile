<?php

namespace Database\Factories;

use App\Models\Branch;
use App\Models\Device;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Device>
 */
class DeviceFactory extends Factory
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
            'code' => strtoupper(fake()->unique()->bothify('TAB###')),
            'name' => 'Tablet '.fake()->numberBetween(1, 99),
            'last_seen_at' => null,
            'app_version' => null,
            'is_active' => true,
        ];
    }

    /**
     * Indicate that the device has been deactivated.
     */
    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => [
            'is_active' => false,
        ]);
    }
}
