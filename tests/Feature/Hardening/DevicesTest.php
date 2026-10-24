<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Device;
use App\Models\Permission;
use App\Models\PersonalAccessToken;
use Carbon\Carbon;
use Illuminate\Support\Facades\RateLimiter;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->otherBranch = Branch::factory()->create(['code' => 'NORTH']);
    Carbon::setTestNow('2026-10-12 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A heartbeat body with overrides.
 *
 * @return array<string, mixed>
 */
function heartbeatBody(array $overrides = []): array
{
    return array_replace([
        'app_version' => '1.0.0',
        'os_version' => '14',
        'device_model' => 'SM-X210',
        'outbox_pending' => 0,
        'outbox_failed' => 0,
        'oldest_pending_at' => null,
        'errors_pending' => 0,
        'last_catalogue_sync_at' => '2026-10-12T03:00:00Z',
        'last_stock_sync_at' => '2026-10-12T03:55:00Z',
        'storage_free_mb' => 4096,
        'printers' => [['id' => 3, 'ok' => true, 'checked_at' => '2026-10-12T03:50:00Z']],
    ], $overrides);
}

/**
 * A device of the given branch (default MAIN) with a heartbeat stored directly.
 */
function deviceWith(array $attributes = [], ?array $heartbeat = null, ?Branch $branch = null): Device
{
    $device = Device::factory()->create(array_replace([
        'branch_id' => ($branch ?? Branch::query()->where('code', 'MAIN')->firstOrFail())->id,
        'last_seen_at' => now(),
        'app_version' => '1.0.0',
    ], $attributes));

    if ($heartbeat !== null) {
        $device->forceFill([
            'last_heartbeat' => array_replace([
                'outbox_pending' => 0, 'outbox_failed' => 0, 'oldest_pending_at' => null, 'errors_pending' => 0,
                'last_catalogue_sync_at' => null, 'last_stock_sync_at' => null, 'storage_free_mb' => 4096,
                'os_version' => '14', 'device_model' => 'SM-X210', 'printers' => [],
            ], $heartbeat),
            'last_heartbeat_at' => now(),
        ])->save();
    }

    return $device;
}

/**
 * The contract's `AdminDevice` keys, in order.
 *
 * @return list<string>
 */
function adminDeviceKeys(): array
{
    return [
        'id', 'code', 'name', 'platform', 'app_version', 'last_seen_at', 'is_active', 'retired_at',
        'last_user', 'heartbeat', 'heartbeat_at', 'health',
    ];
}

describe('GET /app-version', function () {
    it('returns AppVersionInfo from config without auth', function () {
        config(['pos.app_version' => ['min' => '1.1.0', 'latest' => '1.2.0', 'update_url' => 'https://expo.dev/x']]);

        $this->getJson('/api/v1/app-version')
            ->assertOk()
            ->assertExactJson(['data' => ['min_version' => '1.1.0', 'latest_version' => '1.2.0', 'update_url' => 'https://expo.dev/x']]);
    });

    it('defaults to 1.0.0, 1.0.0 and a null url', function () {
        config(['pos.app_version' => ['min' => '1.0.0', 'latest' => '1.0.0', 'update_url' => null]]);

        $this->getJson('/api/v1/app-version')
            ->assertOk()
            ->assertExactJson(['data' => ['min_version' => '1.0.0', 'latest_version' => '1.0.0', 'update_url' => null]]);
    });

    it('throttles at 60 per minute per IP', function () {
        RateLimiter::clear('app-version');

        foreach (range(1, 60) as $i) {
            $this->getJson('/api/v1/app-version')->assertOk();
        }

        $this->getJson('/api/v1/app-version')->assertStatus(429)->assertExactJson(['message' => 'Too Many Attempts.']);
    });
});

describe('POST /devices/heartbeat', function () {
    it('stores the heartbeat, updates last_seen_at, app_version and last_user_id, and answers server_time + app', function () {
        $token = deviceToken($this->cashier);
        $device = Device::query()->sole();
        Carbon::setTestNow('2026-10-12 04:05:00');
        $audits = AuditLog::query()->count();

        $this->withToken($token)
            ->postJson('/api/v1/devices/heartbeat', heartbeatBody(['app_version' => '1.0.3']))
            ->assertOk()
            ->assertExactJson(['data' => [
                'server_time' => '2026-10-12T04:05:00Z',
                'app' => ['min_version' => '1.0.0', 'latest_version' => '1.0.0', 'update_url' => null],
            ]]);

        $device->refresh();

        expect($device->last_seen_at->toIso8601ZuluString())->toBe('2026-10-12T04:05:00Z')
            ->and($device->last_heartbeat_at->toIso8601ZuluString())->toBe('2026-10-12T04:05:00Z')
            ->and($device->app_version)->toBe('1.0.3')
            ->and($device->last_user_id)->toBe($this->cashier->id)
            ->and($device->last_heartbeat)->toEqual([
                'outbox_pending' => 0, 'outbox_failed' => 0, 'oldest_pending_at' => null, 'errors_pending' => 0,
                'last_catalogue_sync_at' => '2026-10-12T03:00:00Z', 'last_stock_sync_at' => '2026-10-12T03:55:00Z',
                'storage_free_mb' => 4096, 'os_version' => '14', 'device_model' => 'SM-X210',
                'printers' => [['id' => 3, 'ok' => true, 'checked_at' => '2026-10-12T03:50:00Z']],
            ])
            ->and(AuditLog::query()->count())->toBe($audits);
    });

    it('accepts a web terminal heartbeat without the outbox fields', function () {
        $token = tokenFor($this->cashier);
        registerDevice($token, null, ['platform' => 'web', 'name' => 'Counter PC'])->assertOk();

        $this->withToken($token)
            ->postJson('/api/v1/devices/heartbeat', ['app_version' => '1.0.0', 'os_version' => 'Chrome 130', 'errors_pending' => 2])
            ->assertOk();

        expect(Device::query()->sole()->last_heartbeat)->toMatchArray(['outbox_pending' => null, 'errors_pending' => 2, 'printers' => []]);
    });

    it('is 409 when the token is not bound to a device', function () {
        $this->withToken(tokenFor($this->cashier))
            ->postJson('/api/v1/devices/heartbeat', heartbeatBody())
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this tablet first.']);
    });

    it('validates the body', function (array $body, string $field) {
        $this->withToken(deviceToken($this->cashier))
            ->postJson('/api/v1/devices/heartbeat', $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        'app_version missing' => [['os_version' => '14'], 'app_version'],
        'app_version too long' => [['app_version' => str_repeat('1', 21)], 'app_version'],
        'outbox_pending negative' => [['app_version' => '1.0.0', 'outbox_pending' => -1], 'outbox_pending'],
        'outbox_failed not int' => [['app_version' => '1.0.0', 'outbox_failed' => 'x'], 'outbox_failed'],
        'oldest_pending_at not a date' => [['app_version' => '1.0.0', 'oldest_pending_at' => 'soon'], 'oldest_pending_at'],
        'storage not int' => [['app_version' => '1.0.0', 'storage_free_mb' => 1.5], 'storage_free_mb'],
        'too many printers' => [['app_version' => '1.0.0', 'printers' => array_fill(0, 21, ['id' => 1, 'ok' => true, 'checked_at' => '2026-10-12T03:00:00Z'])], 'printers'],
        'printer without ok' => [['app_version' => '1.0.0', 'printers' => [['id' => 1, 'checked_at' => '2026-10-12T03:00:00Z']]], 'printers.0.ok'],
    ]);

    it('is 401 without a token', function () {
        $this->postJson('/api/v1/devices/heartbeat', heartbeatBody())->assertUnauthorized();
    });
});

describe('retired devices', function () {
    it('answers 401 "This tablet has been retired." to a token bound to a retired device, on every request', function () {
        $token = deviceToken($this->cashier);
        Device::query()->sole()->forceFill(['is_active' => false, 'retired_at' => now()])->save();

        foreach (['/api/v1/auth/me', '/api/v1/products', '/api/v1/sync/stock'] as $uri) {
            $this->withToken($token)->getJson($uri)
                ->assertUnauthorized()
                ->assertExactJson(['message' => 'This tablet has been retired.']);
        }

        $this->withToken($token)->postJson('/api/v1/sync/orders', ['orders' => []])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'This tablet has been retired.']);
    });

    it('answers 403 when a retired install registers again, without binding the token', function () {
        $installId = newUlid();
        deviceToken($this->cashier, $installId);
        Device::query()->sole()->forceFill(['is_active' => false, 'retired_at' => now()])->save();

        $token = tokenFor($this->cashier);

        registerDevice($token, $installId)
            ->assertForbidden()
            ->assertExactJson(['message' => 'This tablet has been retired. Ask a manager to restore it.']);

        expect(PersonalAccessToken::findToken($token)->device_id)->toBeNull();
    });
});

describe('GET /admin/devices', function () {
    it('lists the branch devices, active first then by code, with heartbeat, last_user and health', function () {
        $t02 = deviceWith(['code' => 'T02', 'name' => 'Bar tab', 'last_user_id' => $this->cashier->id], ['outbox_pending' => 3, 'printers' => [['id' => 1, 'ok' => true, 'checked_at' => '2026-10-12T03:00:00Z']]]);
        deviceWith(['code' => 'T01', 'name' => 'Counter tab']);
        deviceWith(['code' => 'T00', 'name' => 'Old tab', 'is_active' => false, 'retired_at' => now()]);
        deviceWith(['code' => 'T09'], null, $this->otherBranch);

        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/devices?status=all')
            ->assertOk()
            ->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor']]);

        expect(array_column($response->json('data'), 'code'))->toBe(['T01', 'T02', 'T00'])
            ->and(array_keys($response->json('data.1')))->toBe(adminDeviceKeys())
            ->and($response->json('data.1'))->toBe([
                'id' => $t02->id,
                'code' => 'T02',
                'name' => 'Bar tab',
                'platform' => 'android',
                'app_version' => '1.0.0',
                'last_seen_at' => '2026-10-12T04:00:00Z',
                'is_active' => true,
                'retired_at' => null,
                'last_user' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
                'heartbeat' => [
                    'outbox_pending' => 3, 'outbox_failed' => 0, 'oldest_pending_at' => null, 'errors_pending' => 0,
                    'last_catalogue_sync_at' => null, 'last_stock_sync_at' => null, 'storage_free_mb' => 4096,
                    'os_version' => '14', 'device_model' => 'SM-X210',
                    'printers' => [['id' => 1, 'ok' => true, 'checked_at' => '2026-10-12T03:00:00Z']],
                ],
                'heartbeat_at' => '2026-10-12T04:00:00Z',
                'health' => 'ok',
            ])
            ->and($response->json('data.0.heartbeat'))->toBeNull()
            ->and($response->json('data.0.heartbeat_at'))->toBeNull()
            ->and($response->json('data.0.last_user'))->toBeNull()
            ->and($response->json('data.2.health'))->toBe('retired')
            ->and($response->json('data.2.retired_at'))->toBe('2026-10-12T04:00:00Z');
    });

    it('filters by status (default active), platform and search', function () {
        deviceWith(['code' => 'T01', 'name' => 'Counter tab']);
        deviceWith(['code' => 'W02', 'name' => 'Front PC', 'platform' => 'web']);
        deviceWith(['code' => 'T03', 'name' => 'Retired tab', 'is_active' => false, 'retired_at' => now()]);

        $codes = fn (string $query) => array_column(
            $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/devices'.$query)->assertOk()->json('data'),
            'code',
        );

        expect($codes(''))->toBe(['T01', 'W02'])
            ->and($codes('?status=retired'))->toBe(['T03'])
            ->and($codes('?status=all&platform=web'))->toBe(['W02'])
            ->and($codes('?status=all&platform=android'))->toBe(['T01', 'T03'])
            ->and($codes('?search=front'))->toBe(['W02'])
            ->and($codes('?search=t01'))->toBe(['T01']);
    });

    it('derives health', function (array $attributes, ?array $heartbeat, string $health) {
        config(['pos.app_version.min' => '1.0.2']);
        deviceWith(array_replace(['app_version' => '1.0.2'], $attributes), $heartbeat);

        expect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/devices?status=all')->assertOk()->json('data.0.health'))
            ->toBe($health);
    })->with([
        'ok' => [[], [], 'ok'],
        'never seen' => [['last_seen_at' => null], null, 'offline'],
        'seen 31 min ago' => [['last_seen_at' => '2026-10-12 03:29:00'], [], 'offline'],
        'seen 30 min ago' => [['last_seen_at' => '2026-10-12 03:30:00'], [], 'ok'],
        'failed sales' => [[], ['outbox_failed' => 1], 'attention'],
        'pending over 30 min' => [[], ['outbox_pending' => 2, 'oldest_pending_at' => '2026-10-12T03:29:00Z'], 'attention'],
        'pending under 30 min' => [[], ['outbox_pending' => 2, 'oldest_pending_at' => '2026-10-12T03:45:00Z'], 'ok'],
        'old app' => [['app_version' => '1.0.1'], [], 'attention'],
        'low storage' => [[], ['storage_free_mb' => 499], 'attention'],
        'errors pending' => [[], ['errors_pending' => 1], 'attention'],
        'retired' => [['is_active' => false, 'retired_at' => '2026-10-12 03:00:00'], [], 'retired'],
        'web: old app and low storage ignored' => [['platform' => 'web', 'app_version' => '0.9.0'], ['storage_free_mb' => 10, 'outbox_failed' => 3], 'ok'],
        'web: errors pending' => [['platform' => 'web'], ['errors_pending' => 2], 'attention'],
        'web: offline' => [['platform' => 'web', 'last_seen_at' => '2026-10-12 03:00:00'], [], 'offline'],
    ]);

    it('paginates with a cursor and validates the filters', function () {
        foreach (range(1, 3) as $i) {
            deviceWith(['code' => "T0{$i}"]);
        }

        $token = tokenFor($this->owner);
        $first = $this->withToken($token)->getJson('/api/v1/admin/devices?per_page=2')->assertOk();

        expect(array_column($first->json('data'), 'code'))->toBe(['T01', 'T02'])
            ->and($first->json('meta.next_cursor'))->not->toBeNull();

        expect(array_column($this->withToken($token)->getJson('/api/v1/admin/devices?per_page=2&cursor='.$first->json('meta.next_cursor'))->json('data'), 'code'))
            ->toBe(['T03']);

        $this->withToken($token)->getJson('/api/v1/admin/devices?status=gone')->assertUnprocessable()->assertJsonValidationErrors(['status']);
        $this->withToken($token)->getJson('/api/v1/admin/devices?platform=ios')->assertUnprocessable()->assertJsonValidationErrors(['platform']);
        $this->withToken($token)->getJson('/api/v1/admin/devices?per_page=101')->assertUnprocessable()->assertJsonValidationErrors(['per_page']);
    });

    it('is 401 without a token and 403 without system.manage', function () {
        $this->getJson('/api/v1/admin/devices')->assertUnauthorized();
        $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/admin/devices')->assertForbidden();
    });
});

describe('GET /admin/devices/{id}', function () {
    it('returns the AdminDevice, retired devices included', function () {
        $device = deviceWith(['code' => 'T07', 'name' => 'Patio tab', 'last_user_id' => $this->cashier->id], ['outbox_pending' => 2]);
        $retired = deviceWith(['code' => 'T08', 'is_active' => false, 'retired_at' => now()]);
        $token = tokenFor($this->manager);

        $response = $this->withToken($token)->getJson("/api/v1/admin/devices/{$device->id}")->assertOk();

        expect(array_keys($response->json('data')))->toBe(adminDeviceKeys())
            ->and($response->json('data'))->toMatchArray([
                'id' => $device->id, 'code' => 'T07', 'name' => 'Patio tab', 'is_active' => true,
                'last_user' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'], 'health' => 'ok',
            ])
            ->and($response->json('data.heartbeat.outbox_pending'))->toBe(2);

        $this->withToken($token)->getJson("/api/v1/admin/devices/{$retired->id}")
            ->assertOk()
            ->assertJsonPath('data.health', 'retired')
            ->assertJsonPath('data.is_active', false);
    });

    it('is 404 for another branch (unless branch.all) or a missing device, 403 without system.manage, 401 without a token', function () {
        $device = deviceWith();
        $north = deviceWith(['code' => 'T09'], null, $this->otherBranch);

        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/admin/devices/{$north->id}")
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/devices/999999')->assertNotFound();
        // The owner has branch.all: another branch's device is readable (but still not writable).
        $this->withToken(tokenFor($this->owner))->getJson("/api/v1/admin/devices/{$north->id}")->assertOk()->assertJsonPath('data.code', 'T09');
        $this->withToken(tokenFor($this->owner))->patchJson("/api/v1/admin/devices/{$north->id}", ['name' => 'X'])->assertNotFound();
        $this->withToken(tokenFor($this->cashier))->getJson("/api/v1/admin/devices/{$device->id}")->assertForbidden();
        $this->app['auth']->forgetGuards();
        $this->withoutToken()->getJson("/api/v1/admin/devices/{$device->id}")->assertUnauthorized();
    });
});

describe('PATCH /admin/devices/{id}', function () {
    it('keeps the admin name when the tablet registers again (Q-044)', function () {
        $installId = newUlid();
        deviceToken($this->cashier, $installId);
        $device = Device::query()->sole();

        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/admin/devices/{$device->id}", ['name' => 'Front counter'])->assertOk();

        $this->app['auth']->forgetGuards();
        registerDevice(tokenFor($this->cashier), $installId, ['name' => 'Galaxy Tab A9+', 'app_version' => '1.0.4'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Front counter');

        expect($device->refresh()->name)->toBe('Front counter')
            ->and($device->app_version)->toBe('1.0.4');
    });

    it('renames the device, audited device.renamed', function () {
        $device = deviceWith(['code' => 'T01', 'name' => 'Counter tab']);

        $response = $this->withToken(tokenFor($this->manager))
            ->patchJson("/api/v1/admin/devices/{$device->id}", ['name' => 'Front counter'])
            ->assertOk();

        expect(array_keys($response->json('data')))->toBe(adminDeviceKeys())
            ->and($response->json('data.name'))->toBe('Front counter')
            ->and($device->refresh()->name)->toBe('Front counter');

        $audit = lastAudit('device.renamed');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($device->id)
            ->and($audit->changes)->toEqual(['name' => ['from' => 'Counter tab', 'to' => 'Front counter']]);
    });

    it('validates the name', function (array $body) {
        $device = deviceWith();

        $this->withToken(tokenFor($this->manager))
            ->patchJson("/api/v1/admin/devices/{$device->id}", $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name']);
    })->with([
        'null' => [['name' => null]],
        'too long' => [['name' => str_repeat('x', 61)]],
        'not a string' => [['name' => 12]],
    ]);

    it('is 403 without system.manage, 404 for another branch or a missing device, 401 without a token', function () {
        $device = deviceWith();
        $north = deviceWith([], null, $this->otherBranch);

        $this->withToken(tokenFor($this->cashier))->patchJson("/api/v1/admin/devices/{$device->id}", ['name' => 'X'])->assertForbidden();
        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/admin/devices/{$north->id}", ['name' => 'X'])
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        $this->withToken(tokenFor($this->manager))->patchJson('/api/v1/admin/devices/999999', ['name' => 'X'])->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->withoutToken()->patchJson("/api/v1/admin/devices/{$device->id}", ['name' => 'X'])->assertUnauthorized();
    });
});

describe('POST /admin/devices/{id}/retire and /restore', function () {
    it('is 409 with outbox_pending when the last heartbeat reported unsynced sales and confirm is not true', function () {
        $device = deviceWith(['code' => 'T02'], ['outbox_pending' => 5]);
        $token = tokenFor($this->manager);

        $this->withToken($token)->postJson("/api/v1/admin/devices/{$device->id}/retire")
            ->assertStatus(409)
            ->assertExactJson(['message' => 'T02 still has 5 unsynced sales. Sync it first, or retire it anyway.', 'outbox_pending' => 5]);

        $this->withToken($token)->postJson("/api/v1/admin/devices/{$device->id}/retire", ['confirm' => false])->assertStatus(409);

        expect($device->refresh()->is_active)->toBeTrue()
            ->and(lastAudit('device.retired'))->toBeNull();
    });

    it('retires with confirm: deactivates, deletes the bound tokens, audits; the old session gets the retired 401', function () {
        $sessionToken = deviceToken($this->cashier);
        $device = Device::query()->sole();
        $device->forceFill(['last_heartbeat' => ['outbox_pending' => 1], 'last_heartbeat_at' => now()])->save();
        $otherToken = tokenFor($this->cashier);

        $response = $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/devices/{$device->id}/retire", ['confirm' => true])
            ->assertOk();

        expect(array_keys($response->json('data')))->toBe(adminDeviceKeys())
            ->and($response->json('data.is_active'))->toBeFalse()
            ->and($response->json('data.retired_at'))->toBe('2026-10-12T04:00:00Z')
            ->and($response->json('data.health'))->toBe('retired')
            ->and(PersonalAccessToken::findToken($sessionToken))->toBeNull()
            ->and(PersonalAccessToken::findToken($otherToken))->not->toBeNull()
            ->and(lastAudit('device.retired')->actor_id)->toBe($this->manager->id)
            ->and(lastAudit('device.retired')->changes)->toMatchArray(['outbox_pending' => 1, 'confirmed' => true, 'tokens_revoked' => 1]);

        $this->app['auth']->forgetGuards();
        $this->withToken($sessionToken)->getJson('/api/v1/auth/me')->assertUnauthorized();
    });

    it('retires a web terminal without the 409, even with unsynced counts reported', function () {
        $device = deviceWith(['code' => 'W03', 'platform' => 'web'], ['outbox_pending' => 4]);

        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/devices/{$device->id}/retire")
            ->assertOk()
            ->assertJsonPath('data.is_active', false);
    });

    it('restores a retired device, audited; staff can register it again', function () {
        $installId = newUlid();
        deviceToken($this->cashier, $installId);
        $device = Device::query()->sole();
        $token = tokenFor($this->manager);

        $this->withToken($token)->postJson("/api/v1/admin/devices/{$device->id}/retire")->assertOk();

        $this->withToken($token)->postJson("/api/v1/admin/devices/{$device->id}/restore")
            ->assertOk()
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.retired_at', null);

        expect(lastAudit('device.restored')->actor_id)->toBe($this->manager->id);

        registerDevice(tokenFor($this->cashier), $installId)->assertOk();
    });

    it('validates confirm', function () {
        $device = deviceWith();

        $this->withToken(tokenFor($this->manager))
            ->postJson("/api/v1/admin/devices/{$device->id}/retire", ['confirm' => 'yes please'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['confirm']);
    });

    it('is 403 without system.manage, 404 for another branch, 401 without a token', function () {
        $device = deviceWith();
        $north = deviceWith([], null, $this->otherBranch);

        $this->withToken(tokenFor($this->cashier))->postJson("/api/v1/admin/devices/{$device->id}/retire")->assertForbidden();
        $this->withToken(tokenFor($this->cashier))->postJson("/api/v1/admin/devices/{$device->id}/restore")->assertForbidden();
        $this->withToken(tokenFor($this->manager))->postJson("/api/v1/admin/devices/{$north->id}/retire")->assertNotFound();
        $this->withToken(tokenFor($this->manager))->postJson("/api/v1/admin/devices/{$north->id}/restore")->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->withoutToken()->postJson("/api/v1/admin/devices/{$device->id}/retire")->assertUnauthorized();

        expect($device->refresh()->is_active)->toBeTrue()
            ->and($north->refresh()->is_active)->toBeTrue();
    });
});

describe('system.manage', function () {
    it('is granted to Owner and Manager, not Cashier, with the shared description', function () {
        expect($this->owner->hasPermission('system.manage'))->toBeTrue()
            ->and($this->manager->hasPermission('system.manage'))->toBeTrue()
            ->and($this->cashier->hasPermission('system.manage'))->toBeFalse()
            ->and(Permission::query()->where('slug', 'system.manage')->value('description'))->toBe('Manage tablets and the error log');
    });
});

describe('dashboard insight device_unsynced', function () {
    it('flags an active tablet whose heartbeat is over 30 min old with unsynced sales, for system.manage holders only', function () {
        $t02 = deviceWith(['code' => 'T02', 'last_seen_at' => '2026-10-12 02:00:00'], ['outbox_pending' => 5]);
        $t02->forceFill(['last_heartbeat_at' => '2026-10-12 02:00:00'])->save();
        // Recent heartbeat, retired, and nothing pending: not flagged.
        deviceWith(['code' => 'T03'], ['outbox_pending' => 2]);
        $retired = deviceWith(['code' => 'T04', 'is_active' => false, 'retired_at' => now()], ['outbox_pending' => 2]);
        $retired->forceFill(['last_heartbeat_at' => '2026-10-12 01:00:00'])->save();
        $idle = deviceWith(['code' => 'T05'], ['outbox_pending' => 0]);
        $idle->forceFill(['last_heartbeat_at' => '2026-10-12 01:00:00'])->save();

        $insight = collect($this->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'))
            ->firstWhere('key', 'device_unsynced');

        expect($insight)->toBe([
            'key' => 'device_unsynced',
            'severity' => 'warning',
            'title' => 'T02 has 5 unsynced sales (last seen 2 h ago)',
            'message' => 'Bring these tablets online so their sales sync before anything is lost.',
            'count' => 1,
            'action' => 'settings.devices',
        ]);

        $this->app['auth']->forgetGuards();
        $cashierKeys = collect($this->withToken(tokenFor($this->cashier))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'))->pluck('key');

        expect($cashierKeys)->not->toContain('device_unsynced');
    });

    it('counts several tablets in one insight', function () {
        foreach (['T02', 'T03'] as $code) {
            $device = deviceWith(['code' => $code, 'last_seen_at' => '2026-10-12 03:00:00'], ['outbox_pending' => 1]);
            $device->forceFill(['last_heartbeat_at' => '2026-10-12 03:00:00'])->save();
        }

        $insight = collect($this->withToken(tokenFor($this->owner))->getJson('/api/v1/dashboard')->assertOk()->json('data.insights'))
            ->firstWhere('key', 'device_unsynced');

        expect($insight['title'])->toBe('2 tablets have unsynced sales')
            ->and($insight['count'])->toBe(2);
    });
});
