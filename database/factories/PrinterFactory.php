<?php

namespace Database\Factories;

use App\Models\Branch;
use App\Models\Printer;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Printers are created without routes and without side effects (no default-kitchen
 * exclusivity): use the admin endpoints or the actions to exercise the rules.
 *
 * @extends Factory<Printer>
 */
class PrinterFactory extends Factory
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
            'name' => ucfirst(fake()->unique()->lexify('printer ??????')),
            'role' => Printer::ROLE_KITCHEN,
            'host' => fake()->localIpv4(),
            'port' => Printer::DEFAULT_PORT,
            'paper_width_mm' => Printer::DEFAULT_PAPER_WIDTH_MM,
            'is_enabled' => true,
            'is_default_kitchen' => false,
        ];
    }

    /**
     * Place the printer in the given branch.
     */
    public function forBranch(Branch $branch): static
    {
        return $this->state(fn (array $attributes) => [
            'branch_id' => $branch->id,
        ]);
    }

    public function cashier(): static
    {
        return $this->state(fn (array $attributes) => ['role' => Printer::ROLE_CASHIER]);
    }

    public function bar(): static
    {
        return $this->state(fn (array $attributes) => ['role' => Printer::ROLE_BAR]);
    }

    public function disabled(): static
    {
        return $this->state(fn (array $attributes) => ['is_enabled' => false]);
    }

    public function defaultKitchen(): static
    {
        return $this->state(fn (array $attributes) => ['is_default_kitchen' => true]);
    }
}
