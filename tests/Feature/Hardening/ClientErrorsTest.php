<?php

use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use App\Support\Errors\ErrorFingerprint;
use Carbon\Carbon;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-10-12 04:00:00');

    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A valid `ClientError` with overrides.
 *
 * @return array<string, mixed>
 */
function clientError(array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'occurred_at' => '2026-10-12T03:59:00Z',
        'level' => 'error',
        'message' => 'TypeError: Cannot read property total of undefined',
        'stack' => "TypeError: Cannot read property total of undefined\n    at CartTotals (app/sell.tsx:42:13)\n    at renderWithHooks (react.js:1:2)",
        'context' => [
            'screen' => 'sell',
            'app_version' => '1.0.0',
            'os' => 'android',
            'os_version' => '14',
            'device_model' => 'SM-X210',
            'install_id' => newUlid(),
            'online' => true,
            'extra' => ['printer' => 'Counter'],
        ],
    ], $overrides);
}

/**
 * POST /api/v1/client-errors, with a token when given.
 *
 * @param  list<array<string, mixed>>  $errors
 */
function postClientErrors(array $errors, ?string $token = null): TestResponse
{
    $request = $token !== null ? test()->withToken($token) : test();

    return $request->postJson('/api/v1/client-errors', ['errors' => $errors]);
}

describe('POST /client-errors', function () {
    it('accepts errors without a token: 202, one group per fingerprint, an event each', function () {
        $first = clientError();
        $again = clientError(['message' => 'TypeError: Cannot read property total of undefined']);
        $other = clientError(['level' => 'fatal', 'message' => 'Out of memory', 'stack' => null, 'context' => []]);

        postClientErrors([$first, $again, $other])
            ->assertStatus(202)
            ->assertExactJson(['data' => ['accepted' => 3, 'duplicates' => 0]]);

        expect(ErrorGroup::query()->count())->toBe(2)
            ->and(ErrorEvent::query()->count())->toBe(3);

        $group = ErrorGroup::query()->where('level', 'error')->sole();

        expect($group->source)->toBe('app')
            ->and($group->occurrences)->toBe(2)
            ->and($group->status)->toBe('open')
            ->and($group->app_versions)->toBe(['1.0.0'])
            ->and($group->first_seen_at->toIso8601ZuluString())->toBe('2026-10-12T03:59:00Z')
            ->and($group->fingerprint)->toBe(ErrorFingerprint::of('app', 'error', $first['message'], 'at CartTotals (app/sell.tsx:42:13)'));

        $event = ErrorEvent::query()->where('ulid', $first['ulid'])->sole();

        expect($event->branch_id)->toBeNull()
            ->and($event->user_id)->toBeNull()
            ->and($event->device_id)->toBeNull()
            ->and($event->received_at->toIso8601ZuluString())->toBe('2026-10-12T04:00:00Z')
            ->and($event->context)->toEqual($first['context']);
    });

    it('records the user, branch and device when a valid token is sent', function () {
        $token = deviceToken($this->cashier);
        $error = clientError();

        postClientErrors([$error], $token)->assertStatus(202);

        $event = ErrorEvent::query()->sole();

        expect($event->user_id)->toBe($this->cashier->id)
            ->and($event->branch_id)->toBe($this->branch->id)
            ->and($event->device_id)->not->toBeNull();
    });

    it('ignores an invalid token and records the error without a user', function () {
        postClientErrors([clientError()], 'not-a-token')->assertStatus(202);

        expect(ErrorEvent::query()->sole()->user_id)->toBeNull();
    });

    it('is idempotent by ulid: a replayed batch and a ulid repeated in the batch are duplicates', function () {
        $a = clientError();
        $b = clientError(['message' => 'Network request failed']);

        postClientErrors([$a, $b, $a])->assertStatus(202)->assertExactJson(['data' => ['accepted' => 2, 'duplicates' => 1]]);
        postClientErrors([$a, $b])->assertStatus(202)->assertExactJson(['data' => ['accepted' => 0, 'duplicates' => 2]]);

        expect(ErrorEvent::query()->count())->toBe(2)
            ->and(ErrorGroup::query()->sum('occurrences'))->toEqual(2);
    });

    it('groups messages that differ only in digits and ULIDs', function () {
        postClientErrors([
            clientError(['message' => 'Order 01J8Z3K5Q9V7X2M4N6P8R0T1W3 failed after 3 tries']),
            clientError(['message' => 'Order 01J8Z3K5Q9V7X2M4N6P8R0T1W4 failed after 12 tries']),
        ])->assertStatus(202);

        expect(ErrorGroup::query()->sole()->occurrences)->toBe(2)
            ->and(ErrorFingerprint::normalise('Order 01J8Z3K5Q9V7X2M4N6P8R0T1W3 failed after 12 tries'))->toBe('Order # failed after # tries');
    });

    it('truncates over-long strings instead of rejecting them, and drops unknown context keys', function () {
        $extra = [];
        foreach (range(1, 25) as $i) {
            $extra["key{$i}"] = str_repeat('v', 600);
        }

        postClientErrors([clientError([
            'message' => str_repeat('m', 1500),
            'stack' => str_repeat('s', 20000),
            'context' => [
                'screen' => str_repeat('x', 200),
                'app_version' => '1.0.0-very-long-version-string',
                'os' => str_repeat('o', 30),
                'os_version' => str_repeat('9', 30),
                'device_model' => str_repeat('d', 100),
                'authorization' => 'Bearer secret-token',
                'extra' => $extra,
            ],
        ])])->assertStatus(202);

        $event = ErrorEvent::query()->sole();
        $group = ErrorGroup::query()->sole();

        expect(mb_strlen($event->message))->toBe(1000)
            ->and(mb_strlen($group->message))->toBe(1000)
            ->and(mb_strlen($event->stack))->toBe(16000)
            ->and(mb_strlen($event->context['screen']))->toBe(120)
            ->and(mb_strlen($event->context['app_version']))->toBe(20)
            ->and(mb_strlen($event->context['os']))->toBe(20)
            ->and(mb_strlen($event->context['os_version']))->toBe(20)
            ->and(mb_strlen($event->context['device_model']))->toBe(60)
            ->and($event->context)->not->toHaveKey('authorization')
            ->and($event->context['extra'])->toHaveCount(20)
            ->and(mb_strlen($event->context['extra']['key1']))->toBe(500);
    });

    it('reopens a resolved group when a new occurrence arrives', function () {
        postClientErrors([clientError()])->assertStatus(202);
        $group = ErrorGroup::query()->sole();
        $group->forceFill(['status' => 'resolved', 'resolved_at' => now(), 'resolved_by' => $this->cashier->id])->save();

        postClientErrors([clientError(['context' => ['app_version' => '1.0.1']])])->assertStatus(202);

        $group->refresh();

        expect($group->status)->toBe('open')
            ->and($group->resolved_at)->toBeNull()
            ->and($group->resolved_by)->toBeNull()
            ->and($group->occurrences)->toBe(2)
            ->and($group->app_versions)->toBe(['1.0.1', '1.0.0']);
    });

    it('keeps the last 5 distinct app versions, newest first', function () {
        foreach (['1.0.0', '1.0.1', '1.0.2', '1.0.0', '1.1.0', '1.2.0', '1.3.0'] as $version) {
            postClientErrors([clientError(['context' => ['app_version' => $version]])])->assertStatus(202);
        }

        expect(ErrorGroup::query()->sole()->app_versions)->toBe(['1.3.0', '1.2.0', '1.1.0', '1.0.0', '1.0.2']);
    });

    it('records an impossible occurred_at (an unset tablet clock) as the time received', function () {
        postClientErrors([clientError(['occurred_at' => '1970-01-01T00:00:00Z'])])->assertStatus(202);

        expect(ErrorEvent::query()->sole()->occurred_at->toIso8601ZuluString())->toBe('2026-10-12T04:00:00Z');
    });

    it('rejects a malformed body with 422', function (array $body, string $field) {
        $this->postJson('/api/v1/client-errors', $body)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        'no errors' => [[], 'errors'],
        'empty errors' => [['errors' => []], 'errors'],
        'not a list' => [['errors' => 'boom'], 'errors'],
        'missing ulid' => [['errors' => [array_diff_key(clientError(), ['ulid' => 1])]], 'errors.0.ulid'],
        'bad ulid' => [['errors' => [clientError(['ulid' => 'nope'])]], 'errors.0.ulid'],
        'missing occurred_at' => [['errors' => [array_diff_key(clientError(), ['occurred_at' => 1])]], 'errors.0.occurred_at'],
        'bad occurred_at' => [['errors' => [clientError(['occurred_at' => 'yesterday-ish'])]], 'errors.0.occurred_at'],
        'bad level' => [['errors' => [clientError(['level' => 'panic'])]], 'errors.0.level'],
        'missing message' => [['errors' => [array_diff_key(clientError(), ['message' => 1])]], 'errors.0.message'],
        'non-string stack' => [['errors' => [clientError(['stack' => ['a']])]], 'errors.0.stack'],
        'context not an object' => [['errors' => [clientError(['context' => 'x'])]], 'errors.0.context'],
        'bad install_id' => [['errors' => [clientError(['context' => ['install_id' => 'abc']])]], 'errors.0.context.install_id'],
        'bad online' => [['errors' => [clientError(['context' => ['online' => 'maybe']])]], 'errors.0.context.online'],
    ]);

    it('rejects more than 20 errors per request', function () {
        postClientErrors(array_map(fn () => clientError(), range(1, 21)))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['errors']);

        expect(ErrorEvent::query()->count())->toBe(0);
    });

    it('throttles at 30 requests per minute per IP', function () {
        RateLimiter::clear('client-errors');

        foreach (range(1, 30) as $i) {
            postClientErrors([clientError()])->assertStatus(202);
        }

        postClientErrors([clientError()])
            ->assertStatus(429)
            ->assertExactJson(['message' => 'Too Many Attempts.']);
    });
});
