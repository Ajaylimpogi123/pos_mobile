<?php

namespace App\Http\Requests\Printing;

use App\Models\PrintJob;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * GET /api/v1/print-jobs?ulids[]=… (any authenticated user; Web POS & Print Bridge → D):
 * up to 50 job ULIDs, so the list needs no pagination.
 */
class ListPrintJobsRequest extends FormRequest
{
    public const MAX_ULIDS = 50;

    public function authorize(): bool
    {
        return $this->user()?->can('viewAny', PrintJob::class) ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'ulids' => ['required', 'array', 'max:'.self::MAX_ULIDS],
            'ulids.*' => ['required', 'string', 'regex:'.Ulid::PATTERN],
        ];
    }
}
