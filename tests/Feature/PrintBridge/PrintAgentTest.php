<?php

use App\Models\Branch;
use App\Models\Printer;
use App\Models\PrintJob;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Web POS & Print Bridge → E: the print agent's machine endpoints
|--------------------------------------------------------------------------
*/

beforeEach(function () {
    $this->branch = mainBranch();
    $this->printer = Printer::factory()->forBranch($this->branch)->create(['host' => '192.168.1.60', 'port' => 9100]);

    config([
        'pos.print_agent.token' => 'agent-secret',
        'pos.print_agent.branch_id' => $this->branch->id,
    ]);

    $this->travelTo('2026-10-08 03:00:00');
});

function agentHeaders(string $token = 'agent-secret'): array
{
    return ['X-Print-Agent-Token' => $token];
}

function claimJobs(array $body = []): TestResponse
{
    return test()->postJson('/api/v1/print-agent/jobs/claim', array_replace(['agent_id' => 'agent-1'], $body), agentHeaders());
}

function reportResult(string $ulid, array $body): TestResponse
{
    return test()->postJson("/api/v1/print-agent/jobs/{$ulid}/result", array_replace(['agent_id' => 'agent-1'], $body), agentHeaders());
}

function queuedJob(Printer $printer, array $attributes = []): PrintJob
{
    return PrintJob::factory()->forPrinter($printer)->create($attributes);
}

describe('the agent token', function () {
    it('returns 503 when PRINT_AGENT_TOKEN is unset or empty', function (?string $token) {
        config(['pos.print_agent.token' => $token]);

        $this->getJson('/api/v1/print-agent/ping', agentHeaders())
            ->assertStatus(503)
            ->assertExactJson(['message' => 'The print agent is not configured.']);

        $this->postJson('/api/v1/print-agent/jobs/claim', ['agent_id' => 'a'], agentHeaders(''))
            ->assertStatus(503);
    })->with([null, '']);

    it('returns 401 for a missing or wrong token', function (array $headers) {
        $this->getJson('/api/v1/print-agent/ping', $headers)
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid print agent token.']);
    })->with([
        'missing' => [[]],
        'wrong' => [['X-Print-Agent-Token' => 'agent-secreT']],
        'empty' => [['X-Print-Agent-Token' => '']],
    ]);

    it('does not accept a Sanctum token instead', function () {
        seedRoles();
        $token = tokenFor(userWithRole('owner'));

        $this->withToken($token)->postJson('/api/v1/print-agent/jobs/claim', ['agent_id' => 'a'])
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid print agent token.']);
    });

    it('answers JSON even without an Accept header', function () {
        $this->get('/api/v1/print-agent/ping')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Invalid print agent token.']);
    });

    it('throttles at 120 requests a minute', function () {
        foreach (range(1, 120) as $i) {
            $this->getJson('/api/v1/print-agent/ping', agentHeaders())->assertOk();
        }

        $this->getJson('/api/v1/print-agent/ping', agentHeaders())
            ->assertStatus(429)
            ->assertExactJson(['message' => 'Too Many Attempts.']);
    });
});

describe('GET /print-agent/ping', function () {
    it('returns the server time', function () {
        $this->getJson('/api/v1/print-agent/ping', agentHeaders())
            ->assertOk()
            ->assertExactJson(['data' => ['server_time' => '2026-10-08T03:00:00Z']]);
    });
});

describe('POST /print-agent/jobs/claim', function () {
    it('claims the oldest queued jobs as AgentJobs: printing, claimed, attempts + 1', function () {
        $first = queuedJob($this->printer, ['payload' => "\x1B@One\n"]);
        $second = queuedJob($this->printer, ['payload' => "\x1B@Two\n", 'attempts' => 1]);

        $response = claimJobs()->assertOk();

        expect($response->json())->toBe(['data' => [
            [
                'ulid' => $first->ulid,
                'printer' => ['host' => '192.168.1.60', 'port' => 9100],
                'payload_base64' => base64_encode("\x1B@One\n"),
                'attempts' => 1,
            ],
            [
                'ulid' => $second->ulid,
                'printer' => ['host' => '192.168.1.60', 'port' => 9100],
                'payload_base64' => base64_encode("\x1B@Two\n"),
                'attempts' => 2,
            ],
        ]]);

        $first->refresh();

        expect($first->status)->toBe('printing')
            ->and($first->claimed_by)->toBe('agent-1')
            ->and($first->claimed_at->toIso8601ZuluString())->toBe('2026-10-08T03:00:00Z');
    });

    it('returns an empty list when nothing is queued', function () {
        queuedJob($this->printer, ['status' => 'printed']);
        queuedJob($this->printer, ['status' => 'failed']);

        claimJobs()->assertOk()->assertExactJson(['data' => []]);
    });

    it('takes at most limit jobs (default 10), oldest first', function () {
        $jobs = collect(range(1, 12))->map(fn () => queuedJob($this->printer));

        $default = claimJobs()->assertOk()->json('data');
        expect(array_column($default, 'ulid'))->toBe($jobs->take(10)->pluck('ulid')->all());

        $rest = claimJobs(['limit' => 1])->assertOk()->json('data');
        expect(array_column($rest, 'ulid'))->toBe([$jobs[10]->ulid]);
    });

    it('never returns the same job to two claims', function () {
        $jobs = collect(range(1, 4))->map(fn () => queuedJob($this->printer));

        $a = array_column(claimJobs(['agent_id' => 'agent-a', 'limit' => 2])->json('data'), 'ulid');
        $b = array_column(claimJobs(['agent_id' => 'agent-b', 'limit' => 20])->json('data'), 'ulid');
        $c = claimJobs(['agent_id' => 'agent-c'])->json('data');

        expect($a)->toBe($jobs->take(2)->pluck('ulid')->all())
            ->and($b)->toBe($jobs->slice(2)->pluck('ulid')->values()->all())
            ->and($c)->toBe([]);
    });

    it('locks the rows it takes with FOR UPDATE SKIP LOCKED', function () {
        queuedJob($this->printer);
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = strtolower($query->sql);
        });

        claimJobs()->assertOk();

        $select = collect($queries)->first(fn (string $sql) => str_starts_with($sql, 'select') && str_contains($sql, 'print_jobs'));

        expect($select)->toEndWith('for update skip locked');
    });

    it('reclaims a printing job whose claim is older than 60 s', function () {
        $stale = queuedJob($this->printer, ['status' => 'printing', 'claimed_by' => 'dead-agent', 'claimed_at' => now()->subSeconds(61), 'attempts' => 1]);
        $fresh = queuedJob($this->printer, ['status' => 'printing', 'claimed_by' => 'live-agent', 'claimed_at' => now()->subSeconds(59), 'attempts' => 1]);

        $data = claimJobs()->assertOk()->json('data');

        expect(array_column($data, 'ulid'))->toBe([$stale->ulid])
            ->and($data[0]['attempts'])->toBe(2)
            ->and($stale->fresh()->claimed_by)->toBe('agent-1')
            ->and($fresh->fresh()->claimed_by)->toBe('live-agent');
    });

    it('fails a stale printing job that already has 3 attempts, without returning it', function () {
        $spent = queuedJob($this->printer, ['status' => 'printing', 'claimed_by' => 'dead-agent', 'claimed_at' => now()->subSeconds(61), 'attempts' => 3]);
        $retry = queuedJob($this->printer, ['status' => 'printing', 'claimed_by' => 'dead-agent', 'claimed_at' => now()->subSeconds(61), 'attempts' => 2]);

        $data = claimJobs()->assertOk()->json('data');

        expect(array_column($data, 'ulid'))->toBe([$retry->ulid])
            ->and($data[0]['attempts'])->toBe(3);

        $spent->refresh();
        $retry->refresh();

        expect($spent->status)->toBe('failed')
            ->and($spent->last_error)->toBe('The print agent stopped responding.')
            ->and($spent->claimed_by)->toBeNull()
            ->and($spent->claimed_at)->toBeNull()
            ->and($spent->attempts)->toBe(3)
            ->and($retry->status)->toBe('printing')
            ->and($retry->claimed_by)->toBe('agent-1')
            ->and($retry->attempts)->toBe(3);
    });

    it('fails the jobs of a disabled or deleted printer without returning them', function () {
        $disabled = Printer::factory()->forBranch($this->branch)->disabled()->create();
        $deleted = Printer::factory()->forBranch($this->branch)->create();
        $onDisabled = queuedJob($disabled);
        $onDeleted = queuedJob($deleted);
        $deleted->delete();
        $ok = queuedJob($this->printer);

        $data = claimJobs()->assertOk()->json('data');

        expect(array_column($data, 'ulid'))->toBe([$ok->ulid]);

        foreach ([$onDisabled, $onDeleted] as $job) {
            $job->refresh();

            expect($job->status)->toBe('failed')
                ->and($job->last_error)->toBe('The printer is disabled.')
                ->and($job->claimed_by)->toBeNull();
        }
    });

    it('reads the printer\'s host and port at claim time', function () {
        $job = queuedJob($this->printer);
        $this->printer->forceFill(['host' => '10.0.0.9', 'port' => 9101])->save();

        claimJobs()->assertOk()->assertJsonPath('data.0.printer', ['host' => '10.0.0.9', 'port' => 9101])
            ->assertJsonPath('data.0.ulid', $job->ulid);
    });

    it('claims only the agent branch\'s jobs', function () {
        $other = Printer::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->create();
        $foreign = queuedJob($other);
        $mine = queuedJob($this->printer);

        expect(array_column(claimJobs()->json('data'), 'ulid'))->toBe([$mine->ulid])
            ->and($foreign->fresh()->status)->toBe('queued');
    });

    it('returns 422 for a bad body', function (array $body, string $field) {
        $this->postJson('/api/v1/print-agent/jobs/claim', $body, agentHeaders())
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);
    })->with([
        'agent_id missing' => [[], 'agent_id'],
        'agent_id too long' => [['agent_id' => str_repeat('a', 41)], 'agent_id'],
        'limit 0' => [['agent_id' => 'a', 'limit' => 0], 'limit'],
        'limit 21' => [['agent_id' => 'a', 'limit' => 21], 'limit'],
        'limit not an integer' => [['agent_id' => 'a', 'limit' => 'x'], 'limit'],
    ]);
});

describe('POST /print-agent/jobs/{ulid}/result', function () {
    beforeEach(function () {
        $this->job = queuedJob($this->printer);
        claimJobs()->assertOk();
    });

    it('marks a printed job printed', function () {
        $this->travelTo('2026-10-08 03:00:05');

        reportResult($this->job->ulid, ['status' => 'printed'])
            ->assertOk()
            ->assertExactJson(['data' => ['ulid' => $this->job->ulid, 'status' => 'printed']]);

        $job = $this->job->fresh();

        expect($job->status)->toBe('printed')
            ->and($job->printed_at->toIso8601ZuluString())->toBe('2026-10-08T03:00:05Z')
            ->and($job->last_error)->toBeNull();
    });

    it('re-queues a retryable failure while attempts < 3, then fails it', function () {
        // Attempt 1 and 2: back to the queue.
        foreach ([1, 2] as $attempt) {
            reportResult($this->job->ulid, ['status' => 'failed', 'error' => 'Connection refused', 'retryable' => true])
                ->assertOk()
                ->assertExactJson(['data' => ['ulid' => $this->job->ulid, 'status' => 'queued']]);

            $job = $this->job->fresh();

            expect($job->attempts)->toBe($attempt)
                ->and($job->claimed_by)->toBeNull()
                ->and($job->last_error)->toBe('Connection refused');

            claimJobs()->assertOk()->assertJsonPath('data.0.attempts', $attempt + 1);
        }

        // Attempt 3: failed for good.
        reportResult($this->job->ulid, ['status' => 'failed', 'error' => 'Connection refused', 'retryable' => true])
            ->assertOk()
            ->assertExactJson(['data' => ['ulid' => $this->job->ulid, 'status' => 'failed']]);

        expect($this->job->fresh()->status)->toBe('failed')
            ->and($this->job->fresh()->attempts)->toBe(3)
            ->and($this->job->fresh()->last_error)->toBe('Connection refused');

        claimJobs()->assertOk()->assertExactJson(['data' => []]);
    });

    it('fails a non-retryable failure at once', function (array $body) {
        reportResult($this->job->ulid, ['status' => 'failed', 'error' => 'Paper out'] + $body)
            ->assertOk()
            ->assertJsonPath('data.status', 'failed');

        expect($this->job->fresh()->last_error)->toBe('Paper out')
            ->and($this->job->fresh()->attempts)->toBe(1);
    })->with([
        'retryable false' => [['retryable' => false]],
        'retryable missing' => [[]],
    ]);

    it('returns 409 for another agent\'s claim or a job that is not printing', function () {
        reportResult($this->job->ulid, ['agent_id' => 'agent-2', 'status' => 'printed'])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This job is not claimed by this agent.']);

        reportResult($this->job->ulid, ['status' => 'printed'])->assertOk();

        reportResult($this->job->ulid, ['status' => 'printed'])
            ->assertStatus(409)
            ->assertExactJson(['message' => 'This job is not claimed by this agent.']);
    });

    it('returns 404 for an unknown job or another branch\'s job', function () {
        $other = Printer::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->create();
        $foreign = queuedJob($other, ['status' => 'printing', 'claimed_by' => 'agent-1', 'claimed_at' => now()]);

        reportResult(newUlid(), ['status' => 'printed'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        reportResult($foreign->ulid, ['status' => 'printed'])->assertNotFound();

        expect($foreign->fresh()->status)->toBe('printing');
    });

    it('returns 422 for a bad body', function (array $body, string $field) {
        $this->postJson("/api/v1/print-agent/jobs/{$this->job->ulid}/result", $body, agentHeaders())
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);
    })->with([
        'agent_id missing' => [['status' => 'printed'], 'agent_id'],
        'status missing' => [['agent_id' => 'agent-1'], 'status'],
        'status unknown' => [['agent_id' => 'agent-1', 'status' => 'queued'], 'status'],
        'error too long' => [['agent_id' => 'agent-1', 'status' => 'failed', 'error' => str_repeat('e', 256)], 'error'],
        'retryable not a boolean' => [['agent_id' => 'agent-1', 'status' => 'failed', 'retryable' => 'maybe'], 'retryable'],
    ]);

    it('returns 401 without the agent token', function () {
        $this->postJson("/api/v1/print-agent/jobs/{$this->job->ulid}/result", ['agent_id' => 'agent-1', 'status' => 'printed'])
            ->assertUnauthorized();
    });
});

describe('php artisan print-jobs:prune', function () {
    it('deletes printed and failed jobs older than 30 days only', function () {
        $old = now()->subDays(31);
        $oldPrinted = queuedJob($this->printer, ['status' => 'printed', 'created_at' => $old]);
        $oldFailed = queuedJob($this->printer, ['status' => 'failed', 'created_at' => $old]);
        $oldQueued = queuedJob($this->printer, ['status' => 'queued', 'created_at' => $old]);
        $oldPrinting = queuedJob($this->printer, ['status' => 'printing', 'created_at' => $old]);
        $recentPrinted = queuedJob($this->printer, ['status' => 'printed', 'created_at' => now()->subDays(29)]);

        $this->artisan('print-jobs:prune')->assertSuccessful()->expectsOutput('Deleted 2 print job(s).');

        expect(PrintJob::query()->pluck('id')->sort()->values()->all())
            ->toBe(collect([$oldQueued->id, $oldPrinting->id, $recentPrinted->id])->sort()->values()->all())
            ->and(PrintJob::query()->whereKey([$oldPrinted->id, $oldFailed->id])->exists())->toBeFalse();
    });

    it('is scheduled daily', function () {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($event) => str_contains((string) $event->command, 'print-jobs:prune'));

        expect($event)->not->toBeNull()
            ->and($event->expression)->toBe('0 0 * * *');
    });
});
