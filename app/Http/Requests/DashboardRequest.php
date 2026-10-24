<?php

namespace App\Http\Requests;

use App\Actions\Dashboard\BuildSalesSection;
use App\Models\Branch;
use App\Models\User;
use App\Support\BusinessDay;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * GET /api/v1/dashboard (Dashboard Period Filter, v1.28): the optional `period`
 * (`day`, `month` or `year`, default `day`) and `date` (a business date not after the
 * branch's current business date, default the current one). Both only affect `sales`.
 * The dashboard is open to any authenticated user; its sections are gated inside
 * BuildDashboardAction.
 */
class DashboardRequest extends FormRequest
{
    public const MESSAGE_FUTURE_DATE = "The date can't be in the future.";

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'period' => ['sometimes', 'string', Rule::in(BuildSalesSection::PERIODS)],
            'date' => ['bail', 'sometimes', 'date_format:Y-m-d', $this->notInTheFuture(...)],
        ];
    }

    public function selectedPeriod(): string
    {
        return (string) ($this->validated('period') ?? BuildSalesSection::PERIOD_DAY);
    }

    public function anchorDate(): ?string
    {
        $date = $this->validated('date');

        return is_string($date) ? $date : null;
    }

    /**
     * `date`: not after the current business date of the caller's branch.
     */
    private function notInTheFuture(string $attribute, mixed $value, Closure $fail): void
    {
        /** @var User $user */
        $user = $this->user();
        $today = BusinessDay::forBranch(Branch::withTrashed()->find($user->branch_id))->dateOf(now());

        if (is_string($value) && $value > $today) {
            $fail(self::MESSAGE_FUTURE_DATE);
        }
    }
}
