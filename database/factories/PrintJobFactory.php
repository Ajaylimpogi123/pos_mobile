<?php

namespace Database\Factories;

use App\Models\Printer;
use App\Models\PrintJob;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<PrintJob>
 */
class PrintJobFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ulid' => (string) Str::ulid(),
            'branch_id' => fn (array $attributes) => Printer::query()->whereKey($attributes['printer_id'])->withTrashed()->value('branch_id'),
            'device_id' => null,
            'printer_id' => Printer::factory(),
            'kind' => PrintJob::KIND_RECEIPT,
            'order_ulid' => (string) Str::ulid(),
            'copy_no' => 1,
            'is_reprint' => false,
            'payload' => "\x1B@Hello\n",
            'status' => PrintJob::STATUS_QUEUED,
            'attempts' => 0,
            'last_error' => null,
            'claimed_by' => null,
            'claimed_at' => null,
            'printed_at' => null,
            'created_by' => fn (array $attributes) => User::factory()->create(['branch_id' => $attributes['branch_id']])->id,
        ];
    }

    /**
     * A job for the given printer (and its branch).
     */
    public function forPrinter(Printer $printer): static
    {
        return $this->state(fn (array $attributes) => [
            'printer_id' => $printer->id,
            'branch_id' => $printer->branch_id,
        ]);
    }

    public function failed(string $error = 'Connection refused'): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => PrintJob::STATUS_FAILED,
            'attempts' => PrintJob::MAX_ATTEMPTS,
            'last_error' => $error,
        ]);
    }
}
