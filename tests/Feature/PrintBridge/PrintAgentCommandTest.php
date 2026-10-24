<?php

use App\Models\Printer;
use App\Models\PrintJob;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;

/*
|--------------------------------------------------------------------------
| Web POS & Print Bridge → E: `php artisan print-agent:run --once`
|--------------------------------------------------------------------------
|
| The agent's HTTP calls are routed to the real API routes (Http::fake), and the printers
| are TCP listeners on 127.0.0.1 (a connection waits in the backlog until accepted, so the
| bytes are read after the command has run).
|
*/

beforeEach(function () {
    $this->branch = mainBranch();

    config([
        'pos.print_agent.token' => 'agent-secret',
        'pos.print_agent.branch_id' => $this->branch->id,
        'pos.print_agent.api_url' => 'http://pos-server.test/',
        'pos.print_agent.agent_id' => 'counter-pc',
    ]);

    // Forward the agent's requests to this application.
    Http::fake(function (HttpRequest $request) {
        $path = (string) parse_url($request->url(), PHP_URL_PATH);
        $response = test()->json($request->method(), $path, $request->data(), [
            'X-Print-Agent-Token' => $request->header('X-Print-Agent-Token')[0] ?? '',
        ]);

        return Http::response($response->getContent(), $response->getStatusCode(), ['Content-Type' => 'application/json']);
    });

    $this->servers = [];
});

afterEach(function () {
    foreach ($this->servers as $server) {
        fclose($server);
    }
});

/**
 * A fake printer: a TCP listener on 127.0.0.1 with a free port.
 *
 * @return array{0: resource, 1: int}
 */
function fakePrinterServer(): array
{
    $server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
    expect($server)->not->toBeFalse();
    test()->servers = [...test()->servers, $server];

    $port = (int) substr((string) strrchr((string) stream_socket_get_name($server, false), ':'), 1);

    return [$server, $port];
}

/**
 * Everything the next connection to the fake printer sent, or null when none came.
 *
 * @param  resource  $server
 */
function receivedDocument($server): ?string
{
    $connection = @stream_socket_accept($server, 1);

    if ($connection === false) {
        return null;
    }

    stream_set_timeout($connection, 2);
    $bytes = stream_get_contents($connection);
    fclose($connection);

    return $bytes === false ? null : $bytes;
}

/**
 * A port nothing listens on (connections are refused).
 */
function deadPort(): int
{
    $server = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr((string) strrchr((string) stream_socket_get_name($server, false), ':'), 1);
    fclose($server);

    return $port;
}

it('prints each claimed job over TCP and reports it printed', function () {
    [$server, $port] = fakePrinterServer();
    $printer = Printer::factory()->forBranch($this->branch)->create(['host' => '127.0.0.1', 'port' => $port]);
    $first = PrintJob::factory()->forPrinter($printer)->create(['payload' => "\x1B@First\n\x1DV\x00"]);
    $second = PrintJob::factory()->forPrinter($printer)->create(['payload' => "\x1B@Second\n"]);

    $this->artisan('print-agent:run', ['--once' => true])->assertSuccessful();

    expect(receivedDocument($server))->toBe("\x1B@First\n\x1DV\x00")
        ->and(receivedDocument($server))->toBe("\x1B@Second\n");

    foreach ([$first, $second] as $job) {
        $job->refresh();

        expect($job->status)->toBe('printed')
            ->and($job->claimed_by)->toBe('counter-pc')
            ->and($job->attempts)->toBe(1)
            ->and($job->printed_at)->not->toBeNull();
    }

    Http::assertSent(fn (HttpRequest $request) => $request->url() === 'http://pos-server.test/api/v1/print-agent/jobs/claim'
        && $request->header('X-Print-Agent-Token') === ['agent-secret']
        && $request['agent_id'] === 'counter-pc');
});

it('reports a dead printer retryable and skips the rest of its group, without delaying the others', function () {
    [$server, $port] = fakePrinterServer();
    $live = Printer::factory()->forBranch($this->branch)->create(['host' => '127.0.0.1', 'port' => $port]);
    $dead = Printer::factory()->forBranch($this->branch)->create(['host' => '127.0.0.1', 'port' => deadPort()]);

    $deadFirst = PrintJob::factory()->forPrinter($dead)->create();
    $liveJob = PrintJob::factory()->forPrinter($live)->create(['payload' => "\x1B@Live\n"]);
    $deadSecond = PrintJob::factory()->forPrinter($dead)->create();

    $this->artisan('print-agent:run', ['--once' => true])->assertSuccessful();

    expect(receivedDocument($server))->toBe("\x1B@Live\n")
        ->and($liveJob->fresh()->status)->toBe('printed');

    foreach ([$deadFirst, $deadSecond] as $job) {
        $job->refresh();

        // Retryable with attempts 1 < 3: back in the queue, with the reason.
        expect($job->status)->toBe('queued')
            ->and($job->attempts)->toBe(1)
            ->and($job->last_error)->toStartWith("Could not connect to 127.0.0.1:{$dead->port}");
    }

    // The dead printer was tried once: only one job reached the connect step.
    $results = collect(Http::recorded())->map(fn ($pair) => $pair[0])
        ->filter(fn (HttpRequest $request) => str_ends_with($request->url(), '/result'));

    expect($results)->toHaveCount(3)
        ->and($results->filter(fn (HttpRequest $request) => $request['retryable'] === true))->toHaveCount(2);
});

it('fails a job for good after three unreachable rounds', function () {
    $dead = Printer::factory()->forBranch($this->branch)->create(['host' => '127.0.0.1', 'port' => deadPort()]);
    $job = PrintJob::factory()->forPrinter($dead)->create();

    foreach (range(1, 3) as $round) {
        $this->artisan('print-agent:run', ['--once' => true])->assertSuccessful();
    }

    $job->refresh();

    expect($job->status)->toBe('failed')
        ->and($job->attempts)->toBe(3)
        ->and($job->last_error)->toStartWith('Could not connect');
});

it('succeeds with nothing to print', function () {
    $this->artisan('print-agent:run', ['--once' => true])->assertSuccessful();

    Http::assertSentCount(1);
});

it('fails when the API rejects the agent', function () {
    config(['pos.print_agent.token' => 'agent-secret']);
    Http::swap(new HttpFactory);
    Http::fake(['*' => Http::response(['message' => 'Invalid print agent token.'], 401)]);

    $this->artisan('print-agent:run', ['--once' => true])->assertFailed();
});

it('refuses to start without the API URL or the token', function (string $key) {
    config(["pos.print_agent.{$key}" => null]);

    $this->artisan('print-agent:run', ['--once' => true])
        ->expectsOutput('Set PRINT_AGENT_API_URL and PRINT_AGENT_TOKEN first.')
        ->assertFailed();

    Http::assertNothingSent();
})->with(['api_url', 'token']);
