<?php

namespace App\Http\Requests\PrintAgent;

use App\Models\PrintJob;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/print-agent/jobs/{ulid}/result (Web POS & Print Bridge → E). A machine
 * endpoint: the print agent is authorized by its token (EnsurePrintAgentToken).
 */
class ReportPrintJobResultRequest extends FormRequest
{
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
            'agent_id' => ['required', 'string', 'max:40'],
            'status' => ['required', 'string', Rule::in([PrintJob::STATUS_PRINTED, PrintJob::STATUS_FAILED])],
            'error' => ['sometimes', 'nullable', 'string', 'max:255'],
            'retryable' => ['sometimes', 'boolean'],
        ];
    }
}
