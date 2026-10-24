<?php

use App\Models\Branch;
use App\Models\PersonalAccessToken;
use App\Models\Printer;
use App\Models\PrintJob;
use App\Models\User;
use Illuminate\Testing\TestResponse;

/*
|--------------------------------------------------------------------------
| Web POS & Print Bridge → D: the users' print-job endpoints
|--------------------------------------------------------------------------
*/

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->cashier = userWithRole('cashier');
    $this->token = deviceToken($this->cashier);
    $this->printer = Printer::factory()->forBranch($this->branch)->cashier()->create(['name' => 'Counter']);

    // Registering authenticated the guard; each request below authenticates on its own.
    $this->app['auth']->forgetGuards();
    $this->withoutToken();
});

/**
 * A valid POST /print-jobs body for the test's printer.
 *
 * @return array<string, mixed>
 */
function printJobBody(array $overrides = []): array
{
    return array_replace([
        'ulid' => newUlid(),
        'printer_id' => test()->printer->id,
        'kind' => 'receipt',
        'order_ulid' => newUlid(),
        'copy_no' => 1,
        'is_reprint' => false,
        'payload_base64' => base64_encode("\x1B@Receipt\n"),
    ], $overrides);
}

function postPrintJob(array $body, ?string $token = null): TestResponse
{
    return test()->withToken($token ?? test()->token)->postJson('/api/v1/print-jobs', $body);
}

/**
 * The contract's PrintJob keys.
 *
 * @return list<string>
 */
function printJobKeys(): array
{
    return ['ulid', 'printer_id', 'printer_name', 'kind', 'order_ulid', 'copy_no', 'is_reprint', 'status', 'attempts', 'last_error', 'created_at', 'printed_at'];
}

/**
 * A job of another branch, with its own printer.
 */
function otherBranchJob(array $attributes = []): PrintJob
{
    $other = Branch::factory()->create(['code' => 'NORTH']);
    $printer = Printer::factory()->forBranch($other)->create();

    return PrintJob::factory()->forPrinter($printer)->create($attributes);
}

describe('POST /print-jobs', function () {
    it('queues a new job: 201 with the PrintJob', function () {
        $this->travelTo('2026-10-08 03:15:00');
        $body = printJobBody(['copy_no' => 2]);

        $response = postPrintJob($body)->assertCreated();

        $job = PrintJob::query()->sole();

        expect($response->json())->toBe(['data' => [
            'ulid' => $body['ulid'],
            'printer_id' => $this->printer->id,
            'printer_name' => 'Counter',
            'kind' => 'receipt',
            'order_ulid' => $body['order_ulid'],
            'copy_no' => 2,
            'is_reprint' => false,
            'status' => 'queued',
            'attempts' => 0,
            'last_error' => null,
            'created_at' => '2026-10-08T03:15:00Z',
            'printed_at' => null,
        ]])
            ->and($job->payload)->toBe("\x1B@Receipt\n")
            ->and($job->branch_id)->toBe($this->branch->id)
            ->and($job->device_id)->toBe(PersonalAccessToken::findToken($this->token)->device_id)
            ->and($job->created_by)->toBe($this->cashier->id)
            ->and($job->claimed_by)->toBeNull();
    });

    it('defaults copy_no to 1 and is_reprint to false', function () {
        $body = printJobBody();
        unset($body['copy_no'], $body['is_reprint']);

        postPrintJob($body)->assertCreated()
            ->assertJsonPath('data.copy_no', 1)
            ->assertJsonPath('data.is_reprint', false);
    });

    it('needs no order_ulid for x_read, z_read and test', function (string $kind) {
        $body = printJobBody(['kind' => $kind]);
        unset($body['order_ulid']);

        postPrintJob($body)->assertCreated()->assertJsonPath('data.order_ulid', null);
    })->with(['x_read', 'z_read', 'test']);

    it('accepts every kind', function (string $kind) {
        postPrintJob(printJobBody(['kind' => $kind]))->assertCreated()->assertJsonPath('data.kind', $kind);
    })->with(PrintJob::KINDS);

    it('accepts a payload of exactly 65,536 bytes', function () {
        postPrintJob(printJobBody(['payload_base64' => base64_encode(str_repeat('A', 65536))]))->assertCreated();

        expect(strlen(PrintJob::query()->sole()->payload))->toBe(65536);
    });

    it('replays a known ulid: 200 with the existing job, nothing new', function () {
        $body = printJobBody();
        $first = postPrintJob($body)->assertCreated()->json('data');

        $second = postPrintJob($body)->assertOk()->json('data');

        expect($second)->toBe($first)
            ->and(PrintJob::query()->count())->toBe(1);
    });

    it('replays even after the printer was disabled', function () {
        $body = printJobBody();
        postPrintJob($body)->assertCreated();
        $this->printer->forceFill(['is_enabled' => false])->save();

        postPrintJob($body)->assertOk()->assertJsonPath('data.ulid', $body['ulid']);
    });

    it('deduplicates a first print of the same order, kind, printer and copy', function () {
        $body = printJobBody();
        postPrintJob($body)->assertCreated();

        postPrintJob(array_replace($body, ['ulid' => newUlid()]))
            ->assertOk()
            ->assertJsonPath('data.ulid', $body['ulid']);

        expect(PrintJob::query()->count())->toBe(1);
    });

    it('does not deduplicate reprints, other copies, kinds, printers or orders', function (array $changes) {
        $body = printJobBody();
        postPrintJob($body)->assertCreated();

        if (($changes['printer_id'] ?? null) === 'other') {
            $changes['printer_id'] = Printer::factory()->forBranch($this->branch)->create()->id;
        }

        postPrintJob(array_replace($body, ['ulid' => newUlid()], $changes))->assertCreated();

        expect(PrintJob::query()->count())->toBe(2);
    })->with([
        'a reprint' => [['is_reprint' => true]],
        'another copy' => [['copy_no' => 2]],
        'another kind' => [['kind' => 'kitchen']],
        'another printer' => [['printer_id' => 'other']],
        'another order' => [['order_ulid' => '01K9ZZZZZZZZZZZZZZZZZZZZZZ']],
    ]);

    it('never deduplicates x_read, z_read and test prints', function (string $kind) {
        $body = printJobBody(['kind' => $kind, 'order_ulid' => null]);
        postPrintJob($body)->assertCreated();
        postPrintJob(array_replace($body, ['ulid' => newUlid()]))->assertCreated();

        expect(PrintJob::query()->count())->toBe(2);
    })->with(['x_read', 'z_read', 'test']);

    it('returns 409 when the token is not bound to a device', function () {
        postPrintJob(printJobBody(), tokenFor($this->cashier))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Register this terminal first.']);

        expect(PrintJob::query()->count())->toBe(0);
    });

    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/print-jobs', printJobBody())
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    });

    it('lets any role queue a print', function (string $role) {
        $user = User::factory()->forBranch($this->branch)->withRole($role)->create();
        $token = deviceToken($user);
        $this->app['auth']->forgetGuards();

        postPrintJob(printJobBody(), $token)->assertCreated();

        expect(PrintJob::query()->sole()->created_by)->toBe($user->id);
    })->with(['owner', 'manager', 'cashier']);

    it('returns 422 for each required field', function (string $field) {
        $body = printJobBody();
        unset($body[$field]);

        postPrintJob($body)->assertStatus(422)->assertJsonValidationErrors([$field]);
    })->with(['ulid', 'printer_id', 'kind', 'order_ulid', 'payload_base64']);

    it('returns 422 for invalid fields', function (array $changes, string $field, ?string $message) {
        $response = postPrintJob(printJobBody($changes))->assertStatus(422)->assertJsonValidationErrors([$field]);

        if ($message !== null) {
            expect($response->json("errors.{$field}"))->toBe([$message]);
        }

        expect(PrintJob::query()->count())->toBe(0);
    })->with([
        'ulid not a ULID' => [['ulid' => 'nope'], 'ulid', null],
        'ulid lowercase' => [['ulid' => strtolower('01K62Z3K5Q9V7X2M4N6P8R0T1W')], 'ulid', null],
        'printer_id not an integer' => [['printer_id' => 'abc'], 'printer_id', null],
        'printer_id unknown' => [['printer_id' => 999999], 'printer_id', 'The selected printer is invalid.'],
        'kind unknown' => [['kind' => 'label'], 'kind', null],
        'order_ulid not a ULID' => [['order_ulid' => 'nope'], 'order_ulid', null],
        'order_ulid null for a receipt' => [['order_ulid' => null], 'order_ulid', null],
        'copy_no 0' => [['copy_no' => 0], 'copy_no', null],
        'copy_no 11 on a receipt' => [['copy_no' => 11], 'copy_no', null],
        'copy_no 4 on a kitchen ticket' => [['kind' => 'kitchen', 'copy_no' => 4], 'copy_no', null],
        'copy_no 4 on a bill' => [['kind' => 'bill', 'copy_no' => 4], 'copy_no', null],
        'is_reprint not a boolean' => [['is_reprint' => 'maybe'], 'is_reprint', null],
        'payload not base64' => [['payload_base64' => 'not base64!!'], 'payload_base64', 'The print data must be valid base64.'],
        'payload not a string' => [['payload_base64' => 12], 'payload_base64', null],
        'payload too large' => [['payload_base64' => base64_encode(str_repeat('A', 65537))], 'payload_base64', 'The print data is too large.'],
        'payload far too large' => [['payload_base64' => str_repeat('A', 200000)], 'payload_base64', 'The print data is too large.'],
    ]);

    it('accepts receipt copies 1–10, one per equal-split share, without de-duplicating them (Q-047)', function () {
        $order = newUlid();

        foreach ([1, 2, 10] as $copy) {
            postPrintJob(printJobBody(['order_ulid' => $order, 'copy_no' => $copy]))
                ->assertCreated()
                ->assertJsonPath('data.copy_no', $copy);
        }

        expect(PrintJob::query()->where('order_ulid', $order)->count())->toBe(3);
    });

    it('rejects a printer of another branch, a deleted printer and a disabled printer', function () {
        $other = Printer::factory()->forBranch(Branch::factory()->create(['code' => 'NORTH']))->create();
        postPrintJob(printJobBody(['printer_id' => $other->id]))
            ->assertStatus(422)
            ->assertJsonPath('errors.printer_id', ['The selected printer is invalid.']);

        $deleted = Printer::factory()->forBranch($this->branch)->create();
        $deleted->delete();
        postPrintJob(printJobBody(['printer_id' => $deleted->id]))
            ->assertStatus(422)
            ->assertJsonPath('errors.printer_id', ['The selected printer is invalid.']);

        $disabled = Printer::factory()->forBranch($this->branch)->disabled()->create();
        postPrintJob(printJobBody(['printer_id' => $disabled->id]))
            ->assertStatus(422)
            ->assertJsonPath('errors.printer_id', ['This printer is disabled.']);

        expect(PrintJob::query()->count())->toBe(0);
    });

    it('rejects a ulid already used in another branch', function () {
        $job = otherBranchJob();

        postPrintJob(printJobBody(['ulid' => $job->ulid]))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['ulid']);
    });
});

describe('GET /print-jobs', function () {
    it('returns the branch\'s jobs among the ulids, leaving out unknown and other-branch ones', function () {
        $mine = PrintJob::factory()->forPrinter($this->printer)->count(2)->create();
        $other = otherBranchJob();

        $response = $this->withToken($this->token)
            ->getJson('/api/v1/print-jobs?'.http_build_query(['ulids' => [$mine[0]->ulid, $mine[1]->ulid, $other->ulid, newUlid()]]))
            ->assertOk()
            ->assertJsonStructure(['data' => ['*' => printJobKeys()]]);

        expect(collect($response->json('data'))->pluck('ulid')->sort()->values()->all())
            ->toBe(collect([$mine[0]->ulid, $mine[1]->ulid])->sort()->values()->all())
            ->and(array_keys($response->json()))->toBe(['data']);
    });

    it('shows a soft-deleted printer\'s name and the job\'s status details', function () {
        $job = PrintJob::factory()->forPrinter($this->printer)->failed('Could not connect')->create();
        $this->printer->delete();

        $this->withToken($this->token)
            ->getJson('/api/v1/print-jobs?ulids[]='.$job->ulid)
            ->assertOk()
            ->assertJsonPath('data.0.printer_name', 'Counter')
            ->assertJsonPath('data.0.status', 'failed')
            ->assertJsonPath('data.0.attempts', 3)
            ->assertJsonPath('data.0.last_error', 'Could not connect');
    });

    it('returns 422 without ulids, with more than 50, or with a bad ulid', function (string $query, string $field) {
        $this->withToken($this->token)->getJson('/api/v1/print-jobs'.$query)
            ->assertStatus(422)
            ->assertJsonValidationErrors([$field]);
    })->with([
        'missing' => ['', 'ulids'],
        'too many' => [fn () => '?'.http_build_query(['ulids' => array_map(fn () => newUlid(), range(1, 51))]), 'ulids'],
        'not a ULID' => ['?ulids[]=nope', 'ulids.0'],
    ]);

    it('accepts exactly 50 ulids', function () {
        $this->withToken($this->token)
            ->getJson('/api/v1/print-jobs?'.http_build_query(['ulids' => array_map(fn () => newUlid(), range(1, 50))]))
            ->assertOk()
            ->assertExactJson(['data' => []]);
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/print-jobs?ulids[]='.newUlid())->assertUnauthorized();
    });
});

describe('POST /print-jobs/{ulid}/retry', function () {
    it('re-queues a failed job with attempts 0 and no error', function () {
        $job = PrintJob::factory()->forPrinter($this->printer)->failed()->create(['claimed_by' => 'agent-1']);

        $this->withToken($this->token)->postJson("/api/v1/print-jobs/{$job->ulid}/retry")
            ->assertOk()
            ->assertJsonStructure(['data' => printJobKeys()])
            ->assertJsonPath('data.ulid', $job->ulid)
            ->assertJsonPath('data.status', 'queued')
            ->assertJsonPath('data.attempts', 0)
            ->assertJsonPath('data.last_error', null)
            ->assertJsonPath('data.printer_name', 'Counter');

        expect($job->fresh()->status)->toBe('queued')
            ->and($job->fresh()->claimed_by)->toBeNull();
    });

    it('returns 409 unless the job failed', function (string $status) {
        $job = PrintJob::factory()->forPrinter($this->printer)->create(['status' => $status]);

        $this->withToken($this->token)->postJson("/api/v1/print-jobs/{$job->ulid}/retry")
            ->assertStatus(409)
            ->assertExactJson(['message' => 'Only a failed print can be retried.']);

        expect($job->fresh()->status)->toBe($status);
    })->with(['queued', 'printing', 'printed']);

    it('returns 404 for another branch\'s job or an unknown ulid', function () {
        $other = otherBranchJob(['status' => 'failed']);

        $this->withToken($this->token)->postJson("/api/v1/print-jobs/{$other->ulid}/retry")
            ->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);

        $this->withToken($this->token)->postJson('/api/v1/print-jobs/'.newUlid().'/retry')->assertNotFound();

        expect($other->fresh()->status)->toBe('failed');
    });

    it('returns 401 without a token', function () {
        $job = PrintJob::factory()->forPrinter($this->printer)->failed()->create();

        $this->postJson("/api/v1/print-jobs/{$job->ulid}/retry")->assertUnauthorized();
    });
});
