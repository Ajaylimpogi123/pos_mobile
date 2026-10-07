<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Device;
use App\Models\Order;
use App\Models\PersonalAccessToken;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * The token row of a plain-text Sanctum token.
 */
function tokenRow(string $plainTextToken): PersonalAccessToken
{
    return PersonalAccessToken::findToken($plainTextToken);
}

describe('POST /devices/register', function () {
    it('creates the device in the caller\'s branch, codes it T + the padded id, binds the token and audits', function () {
        $token = tokenFor($this->cashier);
        $installId = newUlid();

        $response = registerDevice($token, $installId, ['name' => 'Galaxy Tab A9+', 'app_version' => '1.4.2'])->assertOk();

        $device = Device::query()->sole();

        expect($response->json())->toBe(['data' => [
            'id' => $device->id,
            'code' => sprintf('T%02d', $device->id),
            'name' => 'Galaxy Tab A9+',
        ]])
            ->and($device->install_id)->toBe($installId)
            ->and($device->branch_id)->toBe($this->branch->id)
            ->and($device->app_version)->toBe('1.4.2')
            ->and($device->is_active)->toBeTrue()
            ->and($device->last_seen_at->toIso8601ZuluString())->toBe('2026-09-26T04:00:00Z')
            ->and(tokenRow($token)->device_id)->toBe($device->id);

        $audit = lastAudit('device.registered');

        expect($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_type)->toBe((new Device)->getMorphClass())
            ->and($audit->subject_id)->toBe($device->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'code' => $device->code, 'name' => 'Galaxy Tab A9+', 'app_version' => '1.4.2',
            ]));
    });

    it('pads the code to 2 digits only: T123 for id 123', function () {
        // A device row with an explicit id of 122 moves the auto-increment past it.
        Device::factory()->make(['branch_id' => $this->branch->id, 'code' => 'X122'])->forceFill(['id' => 122])->save();

        $data = registerDevice(tokenFor($this->cashier))->assertOk()->json('data');

        expect($data['id'])->toBeGreaterThanOrEqual(123)
            ->and($data['code'])->toBe('T'.$data['id']);
    });

    it('re-registers the same install as the same device and code, updating name, version and last seen', function () {
        $installId = newUlid();
        $first = registerDevice(tokenFor($this->cashier), $installId, ['name' => 'Tab', 'app_version' => '1.0.0'])->assertOk()->json('data');

        Carbon::setTestNow('2026-09-26 05:00:00');
        $this->app['auth']->forgetGuards();

        // A later login (another user on the same tablet) registers again.
        $token = tokenFor($this->manager);
        $second = registerDevice($token, $installId, ['name' => 'Galaxy Tab A9+', 'app_version' => null])->assertOk()->json('data');

        $device = Device::query()->sole();

        expect($second)->toBe(['id' => $first['id'], 'code' => $first['code'], 'name' => 'Galaxy Tab A9+'])
            ->and($device->app_version)->toBeNull()
            ->and($device->last_seen_at->toIso8601ZuluString())->toBe('2026-09-26T05:00:00Z')
            ->and(tokenRow($token)->device_id)->toBe($device->id)
            ->and(AuditLog::query()->where('action', 'device.registered')->count())->toBe(1);
    });

    it('binds only the calling token', function () {
        $other = tokenFor($this->cashier);
        $token = tokenFor($this->cashier);

        registerDevice($token)->assertOk();

        expect(tokenRow($token)->device_id)->not->toBeNull()
            ->and(tokenRow($other)->device_id)->toBeNull();
    });

    it('records the bound device on online sales', function () {
        $product = Product::factory()->forCategory(Category::factory()->create())->create(['price_cents' => 5000]);
        $token = tokenFor($this->cashier);
        $deviceId = registerDevice($token)->assertOk()->json('data.id');

        $payload = simpleSale([[$product, 1]]);
        $this->withToken($token)->postJson('/api/v1/orders', $payload, ['Idempotency-Key' => $payload['ulid']])->assertCreated();

        expect(Order::query()->sole()->device_id)->toBe($deviceId);
    });

    it('returns 409 when the install is registered to another branch', function () {
        $installId = newUlid();
        $other = Branch::factory()->create(['code' => 'NORTH']);
        $device = Device::factory()->create(['branch_id' => $other->id, 'code' => 'T77']);
        $device->forceFill(['install_id' => $installId])->save();

        $token = tokenFor($this->cashier);

        registerDevice($token, $installId)
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This tablet is registered to another branch.']);

        expect(tokenRow($token)->device_id)->toBeNull()
            ->and($device->fresh()->name)->toBe($device->name);
    });

    it('returns 422 for missing fields', function () {
        $this->withToken(tokenFor($this->cashier))->postJson('/api/v1/devices/register', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['install_id', 'name'])
            ->assertJsonMissingValidationErrors(['app_version']);
    });

    it('returns 422 for invalid fields', function (array $body, string $field) {
        registerDevice(tokenFor($this->cashier), null, $body)
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);

        expect(Device::query()->count())->toBe(0);
    })->with([
        'install_id not a ULID' => [['install_id' => 'not-a-ulid'], 'install_id'],
        'install_id lowercase' => [['install_id' => strtolower('01K62Z3K5Q9V7X2M4N6P8R0T1W')], 'install_id'],
        'name too long' => [['name' => str_repeat('a', 61)], 'name'],
        'name not a string' => [['name' => 12], 'name'],
        'app_version too long' => [['app_version' => str_repeat('1', 21)], 'app_version'],
    ]);

    it('accepts a missing app_version', function () {
        $token = tokenFor($this->cashier);

        $this->withToken($token)->postJson('/api/v1/devices/register', ['install_id' => newUlid(), 'name' => 'Tab'])
            ->assertOk();

        expect(Device::query()->sole()->app_version)->toBeNull();
    });

    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/devices/register', ['install_id' => newUlid(), 'name' => 'Tab'])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('lets any role register', function (string $role) {
        registerDevice(tokenFor(User::factory()->forBranch($this->branch)->withRole($role)->create()))->assertOk();
    })->with(['owner', 'manager', 'cashier']);
});
