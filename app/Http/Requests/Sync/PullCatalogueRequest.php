<?php

namespace App\Http\Requests\Sync;

use App\Support\SyncCursor;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use InvalidArgumentException;

/**
 * GET /api/v1/sync/catalogue (any authenticated user).
 *
 * `cursor` is optional (absent = a full baseline). A cursor that cannot be decoded,
 * has an unknown version, or points into the future is a 422 on `cursor` with
 * {@see self::INVALID_CURSOR}. `limit` is the maximum rows per entity per page.
 */
class PullCatalogueRequest extends FormRequest
{
    public const DEFAULT_LIMIT = 500;

    public const INVALID_CURSOR = 'The sync cursor is invalid. Start a full sync.';

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'cursor' => ['sometimes', 'bail', 'string', 'max:1000', function (string $attribute, mixed $value, Closure $fail): void {
                try {
                    $cursor = SyncCursor::decode($value);
                } catch (InvalidArgumentException) {
                    $fail(self::INVALID_CURSOR);

                    return;
                }

                if ($cursor->isAfter(now())) {
                    $fail(self::INVALID_CURSOR);
                }
            }],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }

    /**
     * The decoded cursor, or null for a full baseline.
     */
    public function syncCursor(): ?SyncCursor
    {
        $cursor = $this->validated('cursor');

        return $cursor === null ? null : SyncCursor::decode($cursor);
    }

    public function limit(): int
    {
        return (int) $this->validated('limit', self::DEFAULT_LIMIT);
    }
}
