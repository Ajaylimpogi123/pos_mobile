<?php

namespace App\Http\Resources\Concerns;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Quantity;
use Illuminate\Support\Collection;

/**
 * The `timeline[]` of a purchase request or order (Ingredients, Recipes & Purchasing → F, G):
 * its audit entries, oldest first, as `{ at, action, by{id,name}|null, details }`. `action` is the
 * audit slug and `details` a worded string or null (Q-027):
 *
 * - `pr.created`: `3 items`; `pr.item_approved`: `2 sack Flour`; `pr.item_declined`:
 *   `2 sack Flour: Too expensive`; both with ` (self-approved)` when the requester decided;
 * - `po.created`: the `po_no`; `po.approved`: `Self-approved` or null; `po.declined`: the reason;
 * - `po.received`: the lines, `1 sack Flour, -0.2 sack Flour: Counted wrong`;
 * - anything else (`pr.updated`, `pr.cancelled`, `po.updated`): null.
 *
 * The `auditLogs.actor` relation must be loaded.
 */
trait PresentsTimeline
{
    /**
     * @param  Collection<int, AuditLog>  $entries
     * @return list<array{at: string|null, action: string, by: array{id: int, name: string}|null, details: string|null}>
     */
    protected function timeline(Collection $entries): array
    {
        return $entries->map(function (AuditLog $entry): array {
            $actor = $entry->actor;

            return [
                'at' => $entry->created_at?->toIso8601ZuluString(),
                'action' => $entry->action,
                'by' => $actor instanceof User ? ['id' => $actor->id, 'name' => $actor->name] : null,
                'details' => $this->details($entry->action, $entry->changes ?? []),
            ];
        })->values()->all();
    }

    /**
     * @param  array<string, mixed>  $changes
     */
    private function details(string $action, array $changes): ?string
    {
        $self = ($changes['self_approved'] ?? false) === true;

        return match ($action) {
            'pr.created' => ($n = count((array) ($changes['items'] ?? []))).($n === 1 ? ' item' : ' items'),
            'pr.item_approved' => $this->quantity($changes).($self ? ' (self-approved)' : ''),
            'pr.item_declined' => $this->quantity($changes).$this->reason($changes).($self ? ' (self-approved)' : ''),
            'po.created' => isset($changes['po_no']) ? (string) $changes['po_no'] : null,
            'po.approved' => $self ? 'Self-approved' : null,
            'po.declined' => isset($changes['reason']) ? (string) $changes['reason'] : null,
            'po.received' => implode(', ', array_map(
                fn (array $line) => $this->quantity($line).$this->reason($line),
                array_filter((array) ($changes['lines'] ?? []), 'is_array'),
            )) ?: null,
            default => null,
        };
    }

    /**
     * `2 sack Flour` from `{ qty, unit, item }`.
     *
     * @param  array<string, mixed>  $changes
     */
    private function quantity(array $changes): string
    {
        $qty = $changes['qty'] ?? null;
        $qty = is_string($qty) && is_numeric($qty) ? Quantity::normalize($qty) : null;

        return trim(implode(' ', array_filter([$qty, $changes['unit'] ?? null, $changes['item'] ?? null], fn ($part) => is_string($part) && $part !== '')));
    }

    /**
     * `: <reason>`, or nothing.
     *
     * @param  array<string, mixed>  $changes
     */
    private function reason(array $changes): string
    {
        $reason = $changes['reason'] ?? null;

        return is_string($reason) && $reason !== '' ? ": {$reason}" : '';
    }

    /**
     * @return array{id: int, name: string}|null
     */
    protected function userSummary(?User $user): ?array
    {
        return $user === null ? null : ['id' => $user->id, 'name' => $user->name];
    }
}
