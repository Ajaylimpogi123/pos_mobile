<?php

use App\Models\Branch;
use App\Models\Category;
use App\Models\Device;
use App\Models\Product;
use App\Models\Shift;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| GET /api/v1/shifts/current (Q-035) and GET /sync/stock from a web terminal (Q-036)
|--------------------------------------------------------------------------
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-10-08 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->token = deviceToken($this->cashier);
    $this->device = Device::query()->sole();
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * GET /shifts/current with a fresh guard (each token authenticates on its own).
 */
function getCurrentShift(?string $token): TestResponse
{
    app('auth')->forgetGuards();
    test()->withoutToken();

    return $token === null
        ? test()->getJson('/api/v1/shifts/current')
        : test()->withToken($token)->getJson('/api/v1/shifts/current');
}

it('returns the open shift of the token\'s device, as GET /shifts/{ulid} does (a cashier without report.zread)', function () {
    $opened = openShift($this->token, $this->cashier);

    $response = getCurrentShift($this->token)->assertOk();

    expect(array_keys($response->json()))->toBe(['data'])
        ->and(array_keys($response->json('data')))->toBe(shiftKeys())
        ->and($response->json('data.ulid'))->toBe($opened['ulid'])
        ->and($response->json('data.status'))->toBe('open')
        ->and($response->json('data.device'))->toBe(['id' => $this->device->id, 'code' => $this->device->code])
        ->and($this->cashier->hasPermission('report.zread'))->toBeFalse();

    $this->app['auth']->forgetGuards();

    expect($response->json())->toBe($this->withToken($this->token)->getJson("/api/v1/shifts/{$opened['ulid']}")->json());
});

it('returns data null when the device has no open shift', function () {
    getCurrentShift($this->token)->assertOk()->assertExactJson(['data' => null]);

    expect(getCurrentShift($this->token)->getContent())->toBe('{"data":null}');
});

it('returns data null once the shift is closed', function () {
    $opened = openShift($this->token, $this->cashier);
    Shift::query()->where('ulid', $opened['ulid'])->update(['closed_at' => now(), 'closed_by' => $this->cashier->id]);

    getCurrentShift($this->token)->assertOk()->assertExactJson(['data' => null]);
});

it('does not return another device\'s open shift', function () {
    $this->app['auth']->forgetGuards();
    $otherToken = deviceToken($this->cashier, newUlid());
    openShift($otherToken, $this->cashier);

    getCurrentShift($this->token)->assertOk()->assertExactJson(['data' => null]);
});

it('isolates other branches', function () {
    $other = Branch::factory()->create(['code' => 'NORTH']);
    // An open shift of this device recorded under another branch is never returned.
    $opened = openShift($this->token, $this->cashier);
    Shift::query()->where('ulid', $opened['ulid'])->update(['branch_id' => $other->id]);

    getCurrentShift($this->token)->assertOk()->assertExactJson(['data' => null]);
});

it('returns 409 when the token is not bound to a device', function () {
    getCurrentShift(tokenFor($this->cashier))
        ->assertStatus(409)
        ->assertExactJson(['message' => 'Register this tablet first.']);
});

it('returns 401 without a token', function () {
    getCurrentShift(null)->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
});

it('lets any role read it', function (string $role) {
    $user = User::factory()->forBranch($this->branch)->withRole($role)->create();
    $this->app['auth']->forgetGuards();

    getCurrentShift(deviceToken($user, newUlid()))->assertOk()->assertExactJson(['data' => null]);
})->with(['owner', 'manager', 'cashier']);

it('lets a web device read sync/stock (Q-036)', function () {
    $product = Product::factory()->forCategory(Category::factory()->create())->create(['track_stock' => true]);
    stockUp($product, 7);

    $this->app['auth']->forgetGuards();
    $token = tokenFor($this->cashier);
    registerDevice($token, null, ['name' => 'Web · Chrome on Windows', 'platform' => 'web'])
        ->assertOk()
        ->assertJsonPath('data.platform', 'web');
    $this->app['auth']->forgetGuards();

    $response = $this->withToken($token)->getJson('/api/v1/sync/stock')->assertOk();

    expect(collect($response->json('data.levels'))->firstWhere('product_id', $product->id))->not->toBeNull();
});
