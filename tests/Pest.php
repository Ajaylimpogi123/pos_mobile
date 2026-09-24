<?php

use App\Models\Branch;
use App\Models\Device;
use App\Models\User;
use Database\Seeders\RolesAndPermissionsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Feature tests run against the isolated pos_mobile_test database (forced in
| phpunit.xml) and are wrapped in RefreshDatabase.
|
*/

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
*/

/**
 * Seed the contract's roles and permissions (the same in every environment).
 */
function seedRoles(): void
{
    test()->seed(RolesAndPermissionsSeeder::class);
}

/**
 * The contract's dev branch (MAIN) with its registered device (TAB01).
 *
 * @return array{0: Branch, 1: Device}
 */
function mainBranchWithDevice(): array
{
    $branch = Branch::factory()->create([
        'code' => 'MAIN',
        'name' => 'Main Branch',
        'timezone' => 'Asia/Manila',
        'day_start_time' => '04:00:00',
    ]);

    $device = Device::factory()->for($branch)->create([
        'code' => 'TAB01',
        'name' => 'Counter Tablet 1',
    ]);

    return [$branch, $device];
}

/**
 * Issue a device-bound token for the user (a device in the user's branch is created if none is given).
 */
function tokenFor(User $user, ?Device $device = null): string
{
    $device ??= Device::factory()->create(['branch_id' => $user->branch_id]);

    return $user->createDeviceToken($device, now()->addHours(24))->plainTextToken;
}
