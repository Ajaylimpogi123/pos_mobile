<?php

namespace Database\Factories;

use App\Models\DiningTable;
use App\Models\TableReservation;
use App\Models\User;
use App\Support\BusinessDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<TableReservation>
 */
class TableReservationFactory extends Factory
{
    protected $model = TableReservation::class;

    /**
     * Define the model's default state: booked, two hours from now, on a new table.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ulid' => (string) Str::ulid(),
            'guest_name' => fake()->lastName(),
            'phone' => null,
            'party_size' => 4,
            'reserved_for' => CarbonImmutable::now()->addHours(2)->startOfSecond(),
            'notes' => null,
            'status' => TableReservation::STATUS_BOOKED,
            'created_by' => User::factory(),
        ];
    }

    /**
     * Book the given table (its branch) at the given time, with the business date set.
     */
    public function forTable(DiningTable $table, ?CarbonImmutable $at = null): static
    {
        return $this->state(function (array $attributes) use ($table, $at) {
            $when = $at ?? CarbonImmutable::instance($attributes['reserved_for']);

            return [
                'branch_id' => $table->branch_id,
                'table_id' => $table->id,
                'reserved_for' => $when,
                'business_date' => BusinessDay::forBranch($table->branch)->dateOf($when),
            ];
        });
    }
}
