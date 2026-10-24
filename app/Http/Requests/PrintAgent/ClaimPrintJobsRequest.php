<?php

namespace App\Http\Requests\PrintAgent;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /api/v1/print-agent/jobs/claim (Web POS & Print Bridge → E). A machine endpoint: the
 * print agent is authorized by its token (EnsurePrintAgentToken), not by a user policy.
 */
class ClaimPrintJobsRequest extends FormRequest
{
    public const DEFAULT_LIMIT = 10;

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
            'limit' => ['sometimes', 'integer', 'min:1', 'max:20'],
        ];
    }

    public function limit(): int
    {
        return (int) ($this->validated('limit') ?? self::DEFAULT_LIMIT);
    }
}
