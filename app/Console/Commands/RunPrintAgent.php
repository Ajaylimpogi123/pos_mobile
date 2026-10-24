<?php

namespace App\Console\Commands;

use App\Http\Middleware\EnsurePrintAgentToken;
use App\Support\Printing\PrinterConnectionException;
use App\Support\Printing\PrinterWriteException;
use App\Support\Printing\RawTcpPrinter;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * The print agent (Web POS & Print Bridge → E). Runs on a PC on the printers' LAN and talks
 * to the API over HTTP (`PRINT_AGENT_API_URL`, `PRINT_AGENT_TOKEN`), so the server may be
 * anywhere. Each round:
 *
 * 1. claims jobs (`POST /api/v1/print-agent/jobs/claim` as `PRINT_AGENT_ID`, default the
 *    hostname);
 * 2. groups them by `host:port` and sends each job's bytes over raw TCP (RawTcpPrinter);
 * 3. reports each result. A connect error is `retryable`; when a printer can't be reached,
 *    the rest of its group is reported with the same retryable error without trying again,
 *    so the other printers aren't delayed.
 *
 * It sleeps 1 s when nothing was claimed (5 s after an API error). `--once` runs one round.
 */
#[Signature('print-agent:run {--once : Run one round and exit}')]
#[Description('Send the web POS print jobs to the network printers')]
class RunPrintAgent extends Command
{
    private const CLAIM_LIMIT = 10;

    private const HTTP_TIMEOUT_SECONDS = 15;

    private const IDLE_SLEEP_SECONDS = 1;

    private const ERROR_SLEEP_SECONDS = 5;

    public function handle(RawTcpPrinter $printer): int
    {
        $apiUrl = config('pos.print_agent.api_url');
        $token = config('pos.print_agent.token');

        if (! is_string($apiUrl) || $apiUrl === '' || ! is_string($token) || $token === '') {
            $this->error('Set PRINT_AGENT_API_URL and PRINT_AGENT_TOKEN first.');

            return self::FAILURE;
        }

        $agentId = $this->agentId();
        $api = Http::baseUrl(rtrim($apiUrl, '/').'/api/v1/print-agent')
            ->withHeaders([EnsurePrintAgentToken::HEADER => $token])
            ->acceptJson()
            ->asJson()
            ->timeout(self::HTTP_TIMEOUT_SECONDS);

        if (! $this->option('once')) {
            $this->info("Print agent {$agentId} is running against {$apiUrl}.");
        }

        while (true) {
            $claimed = $this->round($api, $agentId, $printer);

            if ($this->option('once')) {
                return $claimed === null ? self::FAILURE : self::SUCCESS;
            }

            if ($claimed === null) {
                sleep(self::ERROR_SLEEP_SECONDS);
            } elseif ($claimed === 0) {
                sleep(self::IDLE_SLEEP_SECONDS);
            }
        }
    }

    /**
     * One round: claim, print, report.
     *
     * @return int|null the number of jobs claimed, or null when the claim failed
     */
    private function round(PendingRequest $api, string $agentId, RawTcpPrinter $printer): ?int
    {
        $jobs = $this->claim($api, $agentId);

        if ($jobs === null) {
            return null;
        }

        $groups = [];

        foreach ($jobs as $job) {
            $groups[$job['printer']['host'].':'.$job['printer']['port']][] = $job;
        }

        foreach ($groups as $address => $groupJobs) {
            $deadError = null;

            foreach ($groupJobs as $job) {
                if ($deadError !== null) {
                    $this->report($api, $agentId, $job['ulid'], 'failed', $deadError, true);

                    continue;
                }

                try {
                    $printer->send($job['printer']['host'], (int) $job['printer']['port'], (string) base64_decode($job['payload_base64'], true));
                    $this->report($api, $agentId, $job['ulid'], 'printed');
                    $this->line("Printed {$job['ulid']} on {$address}.");
                } catch (PrinterConnectionException $e) {
                    $deadError = Str::limit($e->getMessage(), 250, '');
                    $this->report($api, $agentId, $job['ulid'], 'failed', $deadError, true);
                    $this->warn("{$deadError} (skipping the rest of its jobs this round)");
                } catch (PrinterWriteException $e) {
                    $this->report($api, $agentId, $job['ulid'], 'failed', Str::limit($e->getMessage(), 250, ''), false);
                    $this->warn("Failed {$job['ulid']}: {$e->getMessage()}");
                }
            }
        }

        return count($jobs);
    }

    /**
     * @return list<array{ulid: string, printer: array{host: string, port: int}, payload_base64: string, attempts: int}>|null
     */
    private function claim(PendingRequest $api, string $agentId): ?array
    {
        try {
            $response = $api->post('jobs/claim', ['agent_id' => $agentId, 'limit' => self::CLAIM_LIMIT]);
        } catch (ConnectionException $e) {
            $this->error("Could not reach the API: {$e->getMessage()}");

            return null;
        }

        if (! $response->successful()) {
            $this->error("Claiming failed ({$response->status()}): ".($response->json('message') ?? $response->body()));

            return null;
        }

        $jobs = $response->json('data');

        return is_array($jobs) ? array_values($jobs) : [];
    }

    private function report(PendingRequest $api, string $agentId, string $ulid, string $status, ?string $error = null, bool $retryable = false): void
    {
        try {
            $response = $api->post("jobs/{$ulid}/result", [
                'agent_id' => $agentId,
                'status' => $status,
                'error' => $error,
                'retryable' => $retryable,
            ]);

            if (! $response->successful()) {
                $this->error("Reporting {$ulid} failed ({$response->status()}): ".($response->json('message') ?? $response->body()));
            }
        } catch (Throwable $e) {
            // The job stays `printing` and is reclaimed after 60 s.
            $this->error("Reporting {$ulid} failed: {$e->getMessage()}");
        }
    }

    /**
     * PRINT_AGENT_ID, or this PC's hostname (at most 40 characters).
     */
    private function agentId(): string
    {
        $configured = config('pos.print_agent.agent_id');
        $id = is_string($configured) && $configured !== '' ? $configured : (gethostname() ?: 'print-agent');

        return mb_substr($id, 0, 40);
    }
}
