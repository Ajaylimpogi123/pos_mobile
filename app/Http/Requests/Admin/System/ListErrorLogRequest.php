<?php

namespace App\Http\Requests\Admin\System;

use App\Http\Requests\CursorListRequest;
use App\Models\ErrorGroup;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/admin/error-log (Hardening & Pilot → B; `system.manage`): `status` (default
 * `open`), `source`, `level`, `search` (the message) and `from` / `to` (`YYYY-MM-DD`, on
 * `last_seen_at`, calendar days in the branch's timezone).
 */
class ListErrorLogRequest extends CursorListRequest
{
    /**
     * Checked before validation, so a caller without the permission always gets 403.
     */
    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', ErrorGroup::class) ?? false;
    }

    protected function filterRules(): array
    {
        return [
            'status' => ['sometimes', 'string', Rule::in(ErrorGroup::STATUSES)],
            'source' => ['sometimes', 'string', Rule::in(ErrorGroup::SOURCES)],
            'level' => ['sometimes', 'string', Rule::in(ErrorGroup::LEVELS)],
            'search' => ['sometimes', 'nullable', 'string', 'max:200'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ];
    }

    /**
     * @return array{status: string, source: string|null, level: string|null, search: string|null, from: string|null, to: string|null}
     */
    public function filters(): array
    {
        return [
            'status' => (string) $this->validated('status', ErrorGroup::STATUS_OPEN),
            'source' => $this->validated('source'),
            'level' => $this->validated('level'),
            'search' => $this->search(),
            'from' => $this->validated('from'),
            'to' => $this->validated('to'),
        ];
    }
}
