<?php

namespace App\Http\Requests\Reports;

use App\Actions\Reports\BuildSalesReportAction;
use App\Models\Order;
use Carbon\CarbonImmutable;
use Carbon\Exceptions\InvalidFormatException;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/reports/sales and GET /api/v1/reports/sales/export (permission `report.view`,
 * Phase 6): `from` and `to` (business dates, `to ≥ from`, at most 366 days counted
 * inclusively, Q-013) and `group_by`. 403 is checked before validation. The errors of the
 * export are JSON too.
 */
class SalesReportRequest extends FormRequest
{
    public const MAX_DAYS = 366;

    public const MESSAGE_RANGE_TOO_LONG = "The range can't be longer than 366 days.";

    public function authorize(): bool
    {
        return $this->user()?->can('viewSalesReports', Order::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'from' => ['required', 'date_format:Y-m-d'],
            'to' => ['bail', 'required', 'date_format:Y-m-d', 'after_or_equal:from', $this->atMostMaxDays(...)],
            'group_by' => ['required', 'string', Rule::in(BuildSalesReportAction::GROUPS)],
        ];
    }

    public function from(): string
    {
        return (string) $this->validated('from');
    }

    public function to(): string
    {
        return (string) $this->validated('to');
    }

    public function groupBy(): string
    {
        return (string) $this->validated('group_by');
    }

    /**
     * `to`: the range `from`..`to`, both included, spans at most 366 business days.
     */
    private function atMostMaxDays(string $attribute, mixed $value, Closure $fail): void
    {
        $from = $this->input('from');

        if (! is_string($from) || ! is_string($value)) {
            return;
        }

        // Carbon throws (rather than returning false) on a malformed date; `from` has its own
        // `date_format` error, so there is nothing more to report here.
        try {
            $start = CarbonImmutable::createFromFormat('!Y-m-d', $from);
            $end = CarbonImmutable::createFromFormat('!Y-m-d', $value);
        } catch (InvalidFormatException) {
            return;
        }

        // An invalid `from` has its own error (`date_format`, which also rejects overflows).
        if (! $start instanceof CarbonImmutable || ! $end instanceof CarbonImmutable || $start->format('Y-m-d') !== $from) {
            return;
        }

        if ((int) $start->diffInDays($end) + 1 > self::MAX_DAYS) {
            $fail(self::MESSAGE_RANGE_TOO_LONG);
        }
    }
}
