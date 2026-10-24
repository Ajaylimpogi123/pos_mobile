<?php

use App\Actions\Errors\RecordErrorOccurrence;
use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Symfony\Component\HttpKernel\Exception\HttpException;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    Carbon::setTestNow('2026-10-12 04:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
});

afterEach(function () {
    Carbon::setTestNow();
});

describe('server 5xx capture', function () {
    it('records an unhandled exception as source server, level error, with the route, method, user and device', function () {
        Route::middleware(['api', 'auth:sanctum', 'session.active'])
            ->post('/api/v1/test-boom', fn () => throw new RuntimeException('Kitchen printer table is corrupt'))
            ->name('v1.test-boom');

        $token = deviceToken($this->manager);

        $this->withToken($token)
            ->postJson('/api/v1/test-boom?pin=1234&card=4111111111111111', ['password' => 'hunter22', 'pin' => '9876', 'note' => 'SECRET-BODY'], ['X-Secret-Header' => 'SECRET-HEADER'])
            ->assertStatus(500)
            ->assertExactJson(['message' => 'Server Error.']);

        $group = ErrorGroup::query()->sole();
        $event = ErrorEvent::query()->sole();

        expect($group->source)->toBe('server')
            ->and($group->level)->toBe('error')
            ->and($group->message)->toBe('RuntimeException: Kitchen printer table is corrupt')
            ->and($group->occurrences)->toBe(1)
            ->and($event->user_id)->toBe($this->manager->id)
            ->and($event->branch_id)->toBe($this->branch->id)
            ->and($event->device_id)->not->toBeNull()
            ->and($event->context)->toEqual(['extra' => ['route' => 'v1.test-boom', 'method' => 'POST', 'status' => '500']])
            ->and($event->stack)->toContain('RuntimeException: Kitchen printer table is corrupt');

        // Never request input, headers, the query string or the token.
        $stored = json_encode([$group->toArray(), $event->toArray()]);

        foreach (['hunter22', '9876', 'SECRET-BODY', 'SECRET-HEADER', '4111111111111111', 'pin=1234', $token] as $secret) {
            expect($stored)->not->toContain($secret);
        }
    });

    it('never records the bound values of a failed query', function () {
        Route::middleware('api')->post('/api/v1/test-query', function () {
            DB::select('select * from table_that_does_not_exist where secret = ?', [request()->input('secret')]);
        });

        $this->postJson('/api/v1/test-query', ['secret' => 'TOP-SECRET-VALUE'])->assertStatus(500);

        $event = ErrorEvent::query()->sole();

        expect($event->message)->toContain('QueryException: SQLSTATE[42S02]')
            ->and($event->message)->toContain('where secret = ?')
            ->and(json_encode([$event->toArray(), ErrorGroup::query()->sole()->toArray()]))->not->toContain('TOP-SECRET-VALUE');
    });

    it('groups the same exception from the same place, without a user when unauthenticated', function () {
        Route::middleware('api')->get('/api/v1/test-boom/{n}', fn (string $n) => throw new LogicException("Bad state {$n}"));

        $this->getJson('/api/v1/test-boom/1')->assertStatus(500);
        $this->getJson('/api/v1/test-boom/2')->assertStatus(500);

        expect(ErrorGroup::query()->sole()->occurrences)->toBe(2)
            ->and(ErrorEvent::query()->whereNotNull('user_id')->count())->toBe(0);
    });

    it('does not record client errors, deliberate non-500 HTTP errors or 4xx', function () {
        Route::middleware('api')->get('/api/v1/test-unavailable', fn () => throw new HttpException(503, 'Down for a moment'));

        $this->getJson('/api/v1/test-unavailable')->assertStatus(503);
        $this->getJson('/api/v1/does-not-exist')->assertNotFound();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();

        expect(ErrorGroup::query()->count())->toBe(0);
    });

    it('fails silently: a recording failure never changes the 500 response', function () {
        $this->mock(RecordErrorOccurrence::class)
            ->shouldReceive('execute')
            ->andThrow(new RuntimeException('error log unavailable'));

        Route::middleware('api')->get('/api/v1/test-boom', fn () => throw new RuntimeException('Original failure'));

        $this->getJson('/api/v1/test-boom')
            ->assertStatus(500)
            ->assertExactJson(['message' => 'Server Error.']);
    });
});
