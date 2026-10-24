<?php

namespace App\Actions\Printing;

use App\Models\Device;
use App\Models\Printer;
use App\Models\PrintJob;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/v1/print-jobs (Web POS & Print Bridge → D): queues the ESC/POS bytes a web
 * terminal built, for the print agent.
 *
 * - **Idempotent by `ulid`:** a job of the caller's branch with this ULID is returned as is.
 * - **First-print deduplication:** a first print (`is_reprint` false) of an order document
 *   (not `x_read`, `z_read` or `test`) returns the branch's existing job with the same
 *   `(order_ulid, kind, printer_id, copy_no)`, so a double-click never prints twice. The
 *   printer row is locked while checking, so two concurrent first prints can't both insert.
 * - Otherwise a new `queued` job, owned by the caller and the token's device. No audit entry.
 */
class CreatePrintJobAction
{
    /**
     * @param  array{ulid: string, printer_id: int|string, kind: string, order_ulid?: string|null, copy_no?: int|string, is_reprint?: bool|int|string}  $data
     */
    public function execute(User $caller, Device $device, array $data, string $payload): PrintJobResult
    {
        try {
            return $this->create($caller, $device, $data, $payload);
        } catch (UniqueConstraintViolationException $e) {
            // The same ULID was queued concurrently and won the insert: replay it.
            $job = $this->findInBranch((int) $caller->branch_id, $data['ulid']) ?? throw $e;

            return PrintJobResult::existing($job);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function create(User $caller, Device $device, array $data, string $payload): PrintJobResult
    {
        $branchId = (int) $caller->branch_id;

        return DB::transaction(function () use ($caller, $device, $data, $payload, $branchId): PrintJobResult {
            $replay = $this->findInBranch($branchId, $data['ulid']);

            if ($replay !== null) {
                return PrintJobResult::existing($replay);
            }

            $printerId = (int) $data['printer_id'];
            $kind = (string) $data['kind'];
            $orderUlid = isset($data['order_ulid']) ? (string) $data['order_ulid'] : null;
            $copyNo = (int) ($data['copy_no'] ?? 1);
            $isReprint = filter_var($data['is_reprint'] ?? false, FILTER_VALIDATE_BOOLEAN);

            if (! $isReprint && ! in_array($kind, PrintJob::KINDS_WITHOUT_ORDER, true) && $orderUlid !== null) {
                Printer::query()->whereKey($printerId)->lockForUpdate()->first();

                $duplicate = PrintJob::query()
                    ->select(PrintJob::SUMMARY_COLUMNS)
                    ->with('printer')
                    ->where('branch_id', $branchId)
                    ->where('order_ulid', $orderUlid)
                    ->where('kind', $kind)
                    ->where('printer_id', $printerId)
                    ->where('copy_no', $copyNo)
                    ->orderBy('id')
                    ->first();

                if ($duplicate !== null) {
                    return PrintJobResult::existing($duplicate);
                }
            }

            $job = new PrintJob;
            $job->forceFill([
                'ulid' => $data['ulid'],
                'branch_id' => $branchId,
                'device_id' => $device->id,
                'printer_id' => $printerId,
                'kind' => $kind,
                'order_ulid' => $orderUlid,
                'copy_no' => $copyNo,
                'is_reprint' => $isReprint,
                'payload' => $payload,
                'status' => PrintJob::STATUS_QUEUED,
                'attempts' => 0,
                'last_error' => null,
                'claimed_by' => null,
                'claimed_at' => null,
                'printed_at' => null,
                'created_by' => $caller->id,
            ])->save();

            return PrintJobResult::created($job->load('printer'));
        });
    }

    private function findInBranch(int $branchId, string $ulid): ?PrintJob
    {
        return PrintJob::query()
            ->select(PrintJob::SUMMARY_COLUMNS)
            ->with('printer')
            ->where('branch_id', $branchId)
            ->where('ulid', $ulid)
            ->first();
    }
}
