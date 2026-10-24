<?php

use App\Models\DiningTable;
use App\Models\Printer;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->owner = userWithRole('owner');
    $this->cashier = userWithRole('cashier');
});

it('returns the dine-in settings with their defaults', function () {
    $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/settings')->assertOk()
        ->assertJsonPath('data.dine_in_enabled', false)
        ->assertJsonPath('data.service_charge_bps', 0);

    $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')->assertOk()
        ->assertJsonPath('data.settings.dine_in_enabled', false)
        ->assertJsonPath('data.settings.service_charge_bps', 0);
});

it('saves the dine-in settings and audits them', function () {
    $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['dine_in_enabled' => true, 'service_charge_bps' => 1000])
        ->assertOk()
        ->assertJsonPath('data.dine_in_enabled', true)
        ->assertJsonPath('data.service_charge_bps', 1000);

    expect(lastAudit('settings.updated')->changes)->toEqual([
        'dine_in_enabled' => ['from' => false, 'to' => true],
        'service_charge_bps' => ['from' => 0, 'to' => 1000],
    ]);

    $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/print-config')
        ->assertJsonPath('data.settings.dine_in_enabled', true)
        ->assertJsonPath('data.settings.service_charge_bps', 1000);
});

it('validates the dine-in settings', function () {
    $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['dine_in_enabled' => 'yes', 'service_charge_bps' => 2001])
        ->assertUnprocessable()->assertJsonValidationErrors(['dine_in_enabled', 'service_charge_bps']);
    $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['service_charge_bps' => -1])
        ->assertUnprocessable()->assertJsonValidationErrors(['service_charge_bps']);
});

it('refuses to turn dine-in off while tabs are open', function () {
    setDineIn($this->branch);
    openTabAt($this->cashier, DiningTable::factory()->forBranch($this->branch)->create()->id);
    openTabAt($this->cashier, DiningTable::factory()->forBranch($this->branch)->create()->id);

    $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['dine_in_enabled' => false, 'service_charge_bps' => 500])
        ->assertConflict()->assertExactJson(['message' => 'Close the 2 open bills first.']);

    $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/settings')->assertJsonPath('data.service_charge_bps', 0);
});

it('says "bill" for a single open tab', function () {
    setDineIn($this->branch);
    openTabAt($this->cashier, DiningTable::factory()->forBranch($this->branch)->create()->id);

    $this->withToken(tokenFor($this->owner))->patchJson('/api/v1/admin/settings', ['dine_in_enabled' => false])
        ->assertConflict()->assertExactJson(['message' => 'Close the 1 open bill first.']);
});

it('accepts the bill print-job kind', function () {
    $printer = Printer::factory()->forBranch($this->branch)->cashier()->create();
    $token = deviceToken($this->cashier, newUlid());

    $this->withToken($token)->postJson('/api/v1/print-jobs', [
        'ulid' => newUlid(),
        'printer_id' => $printer->id,
        'kind' => 'bill',
        'order_ulid' => newUlid(),
        'payload_base64' => base64_encode('BILL'),
    ])->assertCreated()->assertJsonPath('data.kind', 'bill');
});
