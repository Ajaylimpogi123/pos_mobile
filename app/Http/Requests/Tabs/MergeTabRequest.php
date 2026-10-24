<?php

namespace App\Http\Requests\Tabs;

use App\Models\Tab;
use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * POST /api/v1/tabs/{ulid}/merge (T2; `sale.create`; idempotent). Body `into_ulid`: another
 * open tab of the caller's branch (otherwise `422 "The selected into ulid is invalid."`).
 * Re-checked under the tabs' row locks by App\Actions\Tabs\MergeTabAction. See TabRequest.
 */
class MergeTabRequest extends TabRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            ...$this->idempotencyKeyRules(),
            'into_ulid' => ['bail', 'required', 'string', 'regex:'.Ulid::PATTERN, $this->anotherOpenTab(...)],
        ];
    }

    private function anotherOpenTab(string $attribute, mixed $value, Closure $fail): void
    {
        $valid = $value !== $this->tab()->ulid && Tab::query()
            ->where('branch_id', $this->actor()->branch_id)
            ->where('ulid', $value)
            ->where('status', Tab::STATUS_OPEN)
            ->exists();

        if (! $valid) {
            $fail('validation.exists')->translate();
        }
    }
}
