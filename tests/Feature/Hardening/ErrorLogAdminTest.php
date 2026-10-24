<?php

use App\Actions\Errors\RecordErrorOccurrence;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Device;
use App\Models\ErrorEvent;
use App\Models\ErrorGroup;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->otherBranch = Branch::factory()->create(['code' => 'NORTH', 'timezone' => 'Asia/Manila']);
    Carbon::setTestNow('2026-10-12 04:00:00');

    $this->owner = userWithRole('owner', ['name' => 'Olivia Owner']);
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier', ['name' => 'Carla Cashier']);
    $this->otherManager = User::factory()->forBranch($this->otherBranch)->withRole('manager')->create(['name' => 'Nora North']);

    $this->device = Device::factory()->create(['branch_id' => $this->branch->id, 'code' => 'T01', 'name' => 'Counter tab']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * Record an occurrence directly (as the endpoint and the 5xx capture do) and return its group.
 */
function occurrence(array $overrides = []): ErrorGroup
{
    $o = array_replace([
        'ulid' => newUlid(),
        'source' => 'app',
        'level' => 'error',
        'message' => 'Printer offline',
        'stack' => "Error: Printer offline\n    at print (printer.ts:10:5)",
        'top_frame' => 'at print (printer.ts:10:5)',
        'occurred_at' => '2026-10-12T03:00:00Z',
        'context' => ['screen' => 'sell', 'app_version' => '1.0.0'],
        'branch_id' => null,
        'user_id' => null,
        'device_id' => null,
    ], $overrides);

    app(RecordErrorOccurrence::class)->execute(
        $o['ulid'], $o['source'], $o['level'], $o['message'], $o['stack'], $o['top_frame'],
        CarbonImmutable::parse($o['occurred_at']), $o['context'], $o['branch_id'], $o['user_id'], $o['device_id'],
    );

    return ErrorEvent::query()->where('ulid', $o['ulid'])->sole()->group;
}

/**
 * The contract's `ErrorGroup` keys, in order.
 *
 * @return list<string>
 */
function errorGroupKeys(): array
{
    return [
        'id', 'source', 'level', 'message', 'status', 'occurrences', 'first_seen_at', 'last_seen_at',
        'app_versions', 'resolved_at', 'resolved_by', 'latest',
    ];
}

describe('GET /admin/error-log', function () {
    it('lists open groups by last_seen_at desc with latest and meta.summary', function () {
        $older = occurrence(['message' => 'Old failure', 'occurred_at' => '2026-10-10T01:00:00Z']);
        $group = occurrence([
            'branch_id' => $this->branch->id, 'user_id' => $this->cashier->id, 'device_id' => $this->device->id,
            'occurred_at' => '2026-10-12T03:30:00Z',
        ]);
        occurrence(['level' => 'fatal', 'message' => 'Crash on boot', 'occurred_at' => '2026-10-12T02:00:00Z']);
        $resolved = occurrence(['message' => 'Fixed thing']);
        $resolved->forceFill(['status' => 'resolved', 'resolved_at' => now(), 'resolved_by' => $this->owner->id])->save();

        $response = $this->withToken(tokenFor($this->manager))
            ->getJson('/api/v1/admin/error-log')
            ->assertOk()
            ->assertJsonStructure(['data', 'links', 'meta' => ['path', 'per_page', 'next_cursor', 'prev_cursor', 'summary']]);

        expect(array_column($response->json('data'), 'message'))->toBe(['Printer offline', 'Crash on boot', 'Old failure'])
            ->and(array_keys($response->json('data.0')))->toBe(errorGroupKeys())
            ->and($response->json('data.0'))->toMatchArray([
                'id' => $group->id,
                'source' => 'app',
                'level' => 'error',
                'status' => 'open',
                'occurrences' => 1,
                'first_seen_at' => '2026-10-12T03:30:00Z',
                'last_seen_at' => '2026-10-12T03:30:00Z',
                'app_versions' => ['1.0.0'],
                'resolved_at' => null,
                'resolved_by' => null,
                'latest' => [
                    'occurred_at' => '2026-10-12T03:30:00Z',
                    'screen' => 'sell',
                    'app_version' => '1.0.0',
                    'device' => ['id' => $this->device->id, 'code' => 'T01', 'name' => 'Counter tab'],
                    'user' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
                ],
            ])
            ->and($response->json('meta.summary'))->toBe(['open' => 3, 'open_fatal' => 1, 'last_24h' => 3])
            ->and($older->id)->toBeInt();
    });

    it('filters by status, source, level, search and from/to', function () {
        occurrence(['message' => 'Printer offline']);
        occurrence(['source' => 'server', 'message' => 'RuntimeException: boom', 'top_frame' => 'app/X.php:1', 'context' => []]);
        occurrence(['level' => 'fatal', 'message' => 'Crash on boot', 'occurred_at' => '2026-10-01T03:00:00Z']);
        $resolved = occurrence(['message' => 'Fixed thing']);
        $resolved->forceFill(['status' => 'resolved', 'resolved_at' => now(), 'resolved_by' => $this->owner->id])->save();

        $messages = fn (string $query) => array_column(
            $this->withToken(tokenFor($this->owner))->getJson('/api/v1/admin/error-log'.$query)->assertOk()->json('data'),
            'message',
        );

        expect($messages('?status=resolved'))->toBe(['Fixed thing'])
            ->and($messages('?source=server'))->toBe(['RuntimeException: boom'])
            ->and($messages('?level=fatal'))->toBe(['Crash on boot'])
            ->and($messages('?search=printer'))->toBe(['Printer offline'])
            ->and($messages('?from=2026-09-30&to=2026-10-01'))->toBe(['Crash on boot'])
            ->and($messages('?from=2026-10-12'))->toHaveCount(2);
    });

    it('paginates with a cursor and caps per_page at 100', function () {
        foreach (range(1, 3) as $i) {
            occurrence(['message' => "Failure kind {$i}", 'top_frame' => "at f{$i}", 'occurred_at' => "2026-10-12T0{$i}:00:00Z"]);
        }

        $token = tokenFor($this->owner);
        $first = $this->withToken($token)->getJson('/api/v1/admin/error-log?per_page=2')->assertOk();

        expect($first->json('data'))->toHaveCount(2)
            ->and($first->json('meta.per_page'))->toBe(2)
            ->and($first->json('meta.next_cursor'))->not->toBeNull();

        $second = $this->withToken($token)->getJson('/api/v1/admin/error-log?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect(array_column($second->json('data'), 'message'))->toBe(['Failure kind 1'])
            ->and($second->json('meta.next_cursor'))->toBeNull();

        $this->withToken($token)->getJson('/api/v1/admin/error-log?per_page=101')->assertUnprocessable()->assertJsonValidationErrors(['per_page']);
    });

    it('scopes app groups to the caller\'s branch; server and branchless groups are visible to every holder', function () {
        occurrence(['message' => 'Main branch error', 'branch_id' => $this->branch->id]);
        occurrence(['message' => 'North branch error', 'top_frame' => 'at n', 'branch_id' => $this->otherBranch->id]);
        occurrence(['message' => 'Before login', 'top_frame' => 'at b']);
        occurrence(['source' => 'server', 'message' => 'Server boom', 'top_frame' => 'app/S.php:1', 'branch_id' => $this->otherBranch->id, 'context' => []]);

        $messages = fn (User $user) => collect($this->withToken(tokenFor($user))->getJson('/api/v1/admin/error-log')->assertOk()->json('data'))
            ->pluck('message')->sort()->values()->all();

        expect($messages($this->manager))->toBe(['Before login', 'Main branch error', 'Server boom'])
            ->and($messages($this->otherManager))->toBe(['Before login', 'North branch error', 'Server boom'])
            // The owner has branch.all.
            ->and($messages($this->owner))->toBe(['Before login', 'Main branch error', 'North branch error', 'Server boom']);
    });

    it('validates the filters', function (string $query, string $field) {
        $this->withToken(tokenFor($this->owner))
            ->getJson('/api/v1/admin/error-log'.$query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field]);
    })->with([
        ['?status=all', 'status'],
        ['?source=web', 'source'],
        ['?level=info', 'level'],
        ['?from=12-10-2026', 'from'],
        ['?from=2026-10-12&to=2026-10-01', 'to'],
    ]);

    it('is 401 without a token and 403 without system.manage', function () {
        $this->getJson('/api/v1/admin/error-log')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);

        $this->withToken(tokenFor($this->cashier))
            ->getJson('/api/v1/admin/error-log')
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });
});

describe('GET /admin/error-log/{group}', function () {
    it('returns the group plus its latest 50 visible events with stack and context', function () {
        foreach (range(1, 52) as $i) {
            $group = occurrence([
                'occurred_at' => CarbonImmutable::parse('2026-10-11T00:00:00Z')->addMinutes($i)->toIso8601ZuluString(),
                'branch_id' => $this->branch->id, 'user_id' => $this->cashier->id, 'device_id' => $this->device->id,
                'context' => ['screen' => 'sell', 'app_version' => '1.0.0', 'online' => false, 'extra' => ['n' => (string) $i]],
            ]);
        }
        // Another branch's occurrence of the same group: not shown to this branch.
        occurrence(['branch_id' => $this->otherBranch->id, 'occurred_at' => '2026-10-12T03:59:00Z']);

        $response = $this->withToken(tokenFor($this->manager))
            ->getJson("/api/v1/admin/error-log/{$group->id}")
            ->assertOk();

        expect(array_keys($response->json('data')))->toBe([...errorGroupKeys(), 'events'])
            ->and($response->json('data.occurrences'))->toBe(53)
            ->and($response->json('data.latest.occurred_at'))->toBe('2026-10-11T00:52:00Z')
            ->and($response->json('data.events'))->toHaveCount(50)
            ->and(array_keys($response->json('data.events.0')))->toBe(['ulid', 'occurred_at', 'received_at', 'message', 'stack', 'context', 'device', 'user'])
            ->and($response->json('data.events.0'))->toMatchArray([
                'occurred_at' => '2026-10-11T00:52:00Z',
                'received_at' => '2026-10-12T04:00:00Z',
                'message' => 'Printer offline',
                'stack' => "Error: Printer offline\n    at print (printer.ts:10:5)",
                'device' => ['id' => $this->device->id, 'code' => 'T01', 'name' => 'Counter tab'],
                'user' => ['id' => $this->cashier->id, 'name' => 'Carla Cashier'],
            ])
            ->and($response->json('data.events.0.context'))->toEqual(['screen' => 'sell', 'app_version' => '1.0.0', 'online' => false, 'extra' => ['n' => '52']])
            ->and($response->json('data.events.49.occurred_at'))->toBe('2026-10-11T00:03:00Z');
    });

    it('renders an empty context as an object', function () {
        $group = occurrence(['context' => []]);

        $content = $this->withToken(tokenFor($this->owner))->getJson("/api/v1/admin/error-log/{$group->id}")->assertOk()->getContent();

        expect($content)->toContain('"context":{}');
    });

    it('is 404 for a missing group or another branch\'s app group, 403 without system.manage', function () {
        $north = occurrence(['message' => 'North only', 'branch_id' => $this->otherBranch->id]);
        $mine = occurrence(['message' => 'Mine', 'top_frame' => 'at m', 'branch_id' => $this->branch->id]);

        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/error-log/999999')
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/admin/error-log/{$north->id}")->assertNotFound();
        $this->withToken(tokenFor($this->cashier))->getJson("/api/v1/admin/error-log/{$mine->id}")->assertForbidden();
        $this->withoutToken()->getJson("/api/v1/admin/error-log/{$mine->id}")->assertUnauthorized();
    });
});

describe('POST /admin/error-log/{group}/resolve and /reopen', function () {
    it('resolves and reopens a group, audited', function () {
        $group = occurrence();
        $token = tokenFor($this->manager);

        $resolved = $this->withToken($token)->postJson("/api/v1/admin/error-log/{$group->id}/resolve")->assertOk();

        expect(array_keys($resolved->json('data')))->toBe(errorGroupKeys())
            ->and($resolved->json('data.status'))->toBe('resolved')
            ->and($resolved->json('data.resolved_at'))->toBe('2026-10-12T04:00:00Z')
            ->and($resolved->json('data.resolved_by'))->toBe(['id' => $this->manager->id, 'name' => 'Marco Manager'])
            ->and(lastAudit('error.resolved')->actor_id)->toBe($this->manager->id)
            ->and(lastAudit('error.resolved')->subject_id)->toBe($group->id);

        // Resolving again changes nothing and writes no second entry.
        $this->withToken($token)->postJson("/api/v1/admin/error-log/{$group->id}/resolve")->assertOk();
        expect(AuditLog::query()->where('action', 'error.resolved')->count())->toBe(1);

        $this->withToken($token)->getJson('/api/v1/admin/error-log?status=resolved')->assertOk()->assertJsonCount(1, 'data');

        $reopened = $this->withToken($token)->postJson("/api/v1/admin/error-log/{$group->id}/reopen")->assertOk();

        expect($reopened->json('data.status'))->toBe('open')
            ->and($reopened->json('data.resolved_at'))->toBeNull()
            ->and($reopened->json('data.resolved_by'))->toBeNull()
            ->and(lastAudit('error.reopened')->actor_id)->toBe($this->manager->id);
    });

    it('is 403 without system.manage, 404 for a missing group and 401 without a token', function () {
        $group = occurrence();

        $this->withToken(tokenFor($this->cashier))->postJson("/api/v1/admin/error-log/{$group->id}/resolve")->assertForbidden();
        $this->withToken(tokenFor($this->cashier))->postJson("/api/v1/admin/error-log/{$group->id}/reopen")->assertForbidden();
        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/error-log/999999/resolve')->assertNotFound();
        $this->withoutToken()->postJson("/api/v1/admin/error-log/{$group->id}/resolve")->assertUnauthorized();

        expect($group->refresh()->status)->toBe('open');
    });
});

describe('error-log:prune', function () {
    it('deletes events received over 90 days ago and the groups left without events', function () {
        Carbon::setTestNow('2026-06-01 00:00:00');
        $old = occurrence(['message' => 'Old only']);
        $mixed = occurrence(['message' => 'Mixed', 'top_frame' => 'at mixed']);
        Carbon::setTestNow('2026-10-12 04:00:00');
        occurrence(['message' => 'Mixed', 'top_frame' => 'at mixed']);

        Artisan::call('error-log:prune');

        expect(ErrorGroup::query()->whereKey($old->id)->exists())->toBeFalse()
            ->and(ErrorGroup::query()->whereKey($mixed->id)->exists())->toBeTrue()
            ->and(ErrorEvent::query()->count())->toBe(1);
    });

    it('is scheduled daily', function () {
        $events = collect(app(Schedule::class)->events())
            ->filter(fn ($event) => str_contains((string) $event->command, 'error-log:prune'));

        expect($events)->toHaveCount(1)
            ->and($events->first()->expression)->toBe('0 0 * * *');
    });
});
