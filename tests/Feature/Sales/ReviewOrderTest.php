<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Order;
use App\Models\Product;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-09-26 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);

    $this->hotDog = Product::factory()->forCategory(Category::factory()->create())->create(['name' => 'Hot Dog', 'price_cents' => 8000]);

    $this->deviceToken = deviceToken($this->cashier);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Sync one offline sale paid short (flagged `payment_short`) and return its `Order` JSON.
 *
 * @return array<string, mixed>
 */
function flaggedOfflineOrder(array $overrides = []): array
{
    $order = offlineOrder(test()->cashier, [[test()->hotDog, 1]], array_replace([
        'payments' => [['method' => 'cash', 'amount_cents' => 5000, 'reference_no' => null]],
    ], $overrides));

    $result = syncOrders(test()->deviceToken, [$order])->assertOk()->json('data.0');

    expect($result['status'])->toBe('accepted');

    return $result['order'];
}

function reviewOrder(User $user, string $ulid, array $body = []): TestResponse
{
    return test()->withToken(tokenFor($user))->postJson("/api/v1/orders/{$ulid}/review", $body);
}

describe('POST /orders/{ulid}/review', function () {
    it('marks the order reviewed, keeps the reasons and audits the reasons and the note', function () {
        $order = flaggedOfflineOrder();
        Carbon::setTestNow('2026-09-26 05:00:00');

        $response = reviewOrder($this->manager, $order['ulid'], ['note' => 'Customer paid the rest in cash.'])->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(orderKeys())
            ->and($response->json('data'))->toMatchArray([
                'ulid' => $order['ulid'],
                'needs_review' => false,
                'review_reasons' => ['payment_short'],
                'reviewed_at' => '2026-09-26T05:00:00Z',
                'reviewed_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
                'source' => 'offline',
                'synced_at' => '2026-09-26T04:00:00Z',
            ]);

        $stored = Order::query()->sole();

        expect($stored->needs_review)->toBeFalse()
            ->and($stored->reviewed_by)->toBe($this->manager->id)
            ->and($stored->review_reasons)->toBe(['payment_short']);

        $audit = lastAudit('order.reviewed');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($stored->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'reasons' => ['payment_short'], 'note' => 'Customer paid the rest in cash.',
            ]));
    });

    it('accepts no note', function () {
        $order = flaggedOfflineOrder();

        reviewOrder($this->owner, $order['ulid'])->assertOk()->assertJsonPath('data.needs_review', false);

        expect(lastAudit('order.reviewed')->changes['note'])->toBeNull();
    });

    it('shows the reviewer on show and in the list', function () {
        $order = flaggedOfflineOrder();
        reviewOrder($this->manager, $order['ulid'])->assertOk();

        $token = tokenFor($this->manager);

        $this->withToken($token)->getJson("/api/v1/orders/{$order['ulid']}")
            ->assertOk()
            ->assertJsonPath('data.reviewed_by', ['id' => $this->manager->id, 'name' => 'Marco Manager']);

        $summary = $this->withToken($token)->getJson('/api/v1/orders')->assertOk()->json('data.0');

        expect(array_keys($summary))->toBe(orderSummaryKeys())
            ->and($summary)->toMatchArray([
                'order_no' => $order['order_no'],
                'source' => 'offline',
                'needs_review' => false,
                'review_reasons' => ['payment_short'],
                'reviewed_at' => '2026-09-26T04:00:00Z',
                'reviewed_by' => ['id' => $this->manager->id, 'name' => 'Marco Manager'],
                'synced_at' => '2026-09-26T04:00:00Z',
            ]);
    });

    it('returns 409 when the order does not need review', function () {
        $online = sell($this->cashier, [[$this->hotDog, 1]]);

        reviewOrder($this->manager, $online['ulid'])
            ->assertStatus(409)
            ->assertExactJson(['message' => "This order doesn't need review."]);

        expect(AuditLog::query()->where('action', 'order.reviewed')->count())->toBe(0);
    });

    it('returns 409 on a second review', function () {
        $order = flaggedOfflineOrder();
        reviewOrder($this->manager, $order['ulid'])->assertOk();

        reviewOrder($this->owner, $order['ulid'])
            ->assertStatus(409)
            ->assertExactJson(['message' => "This order doesn't need review."]);

        expect(Order::query()->sole()->reviewed_by)->toBe($this->manager->id);
    });

    it('returns 403 without order.review', function () {
        $order = flaggedOfflineOrder();

        reviewOrder($this->cashier, $order['ulid'])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        expect(Order::query()->sole()->needs_review)->toBeTrue();
    });

    it('returns 404 for another branch\'s order and an unknown ulid', function () {
        $order = flaggedOfflineOrder();
        $northManager = User::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->withRole('manager')->create();

        reviewOrder($northManager, $order['ulid'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        reviewOrder($this->manager, newUlid())
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        expect(Order::query()->sole()->needs_review)->toBeTrue();
    });

    it('accepts a lowercase ulid', function () {
        $order = flaggedOfflineOrder();

        reviewOrder($this->manager, strtolower($order['ulid']))->assertOk();
    });

    it('returns 422 for a bad note', function (mixed $note) {
        $order = flaggedOfflineOrder();

        reviewOrder($this->manager, $order['ulid'], ['note' => $note])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['note']);

        expect(Order::query()->sole()->needs_review)->toBeTrue();
    })->with([
        'too long' => [str_repeat('a', 256)],
        'not a string' => [12],
    ]);

    it('returns 401 without a token', function () {
        $order = flaggedOfflineOrder();

        $this->flushHeaders()->postJson("/api/v1/orders/{$order['ulid']}/review")
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('leaves order.reviewed out of the dashboard activity feed', function () {
        $order = flaggedOfflineOrder();
        reviewOrder($this->manager, $order['ulid'])->assertOk();

        $activity = $this->withToken(tokenFor($this->manager))->getJson('/api/v1/dashboard')->assertOk()->json('data.activity');

        expect(array_column($activity['recent_changes'], 'action'))->not->toContain('order.reviewed')
            ->and(array_column($activity['recent_changes'], 'action'))->not->toContain('order.completed');
    });
});

describe('GET /orders?needs_review', function () {
    it('filters on needs_review with the same visibility', function () {
        $flagged = flaggedOfflineOrder();
        $clean = flaggedOfflineOrder(['payments' => [['method' => 'cash', 'amount_cents' => 8000, 'reference_no' => null]]]);
        $online = sell($this->cashier, [[$this->hotDog, 1]]);

        $token = tokenFor($this->manager);

        expect(array_column($this->withToken($token)->getJson('/api/v1/orders?needs_review=true')->assertOk()->json('data'), 'ulid'))
            ->toBe([$flagged['ulid']])
            ->and(array_column($this->withToken($token)->getJson('/api/v1/orders?needs_review=1')->assertOk()->json('data'), 'ulid'))
            ->toBe([$flagged['ulid']])
            ->and(array_column($this->withToken($token)->getJson('/api/v1/orders?needs_review=false')->assertOk()->json('data'), 'ulid'))
            ->toEqualCanonicalizing([$clean['ulid'], $online['ulid']])
            ->and($this->withToken($token)->getJson('/api/v1/orders')->assertOk()->json('data'))->toHaveCount(3);
    });

    it('keeps the cashier-only visibility', function () {
        flaggedOfflineOrder(['cashier_id' => $this->manager->id]);
        $own = flaggedOfflineOrder();

        $data = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/orders?needs_review=true')->assertOk()->json('data');

        expect(array_column($data, 'ulid'))->toBe([$own['ulid']]);
    });

    it('returns 422 for a non-boolean value', function () {
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/orders?needs_review=maybe')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['needs_review']);
    });
});
