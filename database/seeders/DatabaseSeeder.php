<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        // Every environment.
        $this->call(RolesAndPermissionsSeeder::class);

        // Local development only (branch MAIN, device TAB01, dev logins).
        if (app()->environment('local')) {
            $this->call(DevSeeder::class);
        }
    }
}
