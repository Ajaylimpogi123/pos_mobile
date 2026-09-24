<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\Device;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * Local development data. Never runs outside the `local` environment. Idempotent.
 */
class DevSeeder extends Seeder
{
    public function run(): void
    {
        if (! app()->environment('local')) {
            $this->command?->warn('DevSeeder skipped: only runs in the local environment.');

            return;
        }

        $branch = Branch::query()->updateOrCreate(['code' => 'MAIN'], [
            'name' => 'Main Branch',
            'timezone' => 'Asia/Manila',
            'day_start_time' => '04:00:00',
            'is_active' => true,
        ]);

        Device::query()->updateOrCreate(['code' => 'TAB01'], [
            'branch_id' => $branch->id,
            'name' => 'Counter Tablet 1',
            'is_active' => true,
        ]);

        $roleIds = Role::query()->pluck('id', 'slug');

        $users = [
            ['email' => 'owner@pos.test', 'name' => 'Olivia Owner', 'role' => 'owner', 'is_active' => true],
            ['email' => 'manager@pos.test', 'name' => 'Marco Manager', 'role' => 'manager', 'is_active' => true],
            ['email' => 'cashier@pos.test', 'name' => 'Carla Cashier', 'role' => 'cashier', 'is_active' => true],
            ['email' => 'inactive@pos.test', 'name' => 'Ivan Inactive', 'role' => 'cashier', 'is_active' => false],
        ];

        foreach ($users as $user) {
            User::query()->updateOrCreate(['email' => $user['email']], [
                'branch_id' => $branch->id,
                'role_id' => $roleIds[$user['role']],
                'name' => $user['name'],
                'password' => 'password',
                'is_active' => $user['is_active'],
            ]);
        }
    }
}
