<?php

namespace App\Http\Requests\Errors;

use App\Models\ErrorGroup;
use App\Support\Ulid;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST /api/v1/client-errors (Hardening & Pilot → B; auth optional, 30/min per IP).
 *
 * Only a malformed body is a 422: 1..20 errors, each with a ULID, a date, a level and a
 * message, and the context fields of the right types. Over-long strings are not rejected:
 * App\Actions\Errors\RecordClientErrorsAction truncates them.
 */
class StoreClientErrorsRequest extends FormRequest
{
    public const MAX_ERRORS = 20;

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
            'errors' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_ERRORS],
            'errors.*' => ['required', 'array'],
            'errors.*.ulid' => ['required', 'string', 'regex:'.Ulid::PATTERN],
            'errors.*.occurred_at' => ['required', 'date'],
            'errors.*.level' => ['required', 'string', Rule::in(ErrorGroup::LEVELS)],
            'errors.*.message' => ['required', 'string'],
            'errors.*.stack' => ['sometimes', 'nullable', 'string'],
            'errors.*.context' => ['sometimes', 'nullable', 'array'],
            'errors.*.context.screen' => ['sometimes', 'nullable', 'string'],
            'errors.*.context.app_version' => ['sometimes', 'nullable', 'string'],
            'errors.*.context.os' => ['sometimes', 'nullable', 'string'],
            'errors.*.context.os_version' => ['sometimes', 'nullable', 'string'],
            'errors.*.context.device_model' => ['sometimes', 'nullable', 'string'],
            'errors.*.context.install_id' => ['sometimes', 'nullable', 'string', 'regex:'.Ulid::PATTERN],
            'errors.*.context.online' => ['sometimes', 'nullable', 'boolean'],
            'errors.*.context.extra' => ['sometimes', 'nullable', 'array'],
        ];
    }

    /**
     * The validated errors (the action keeps only the contract's context keys).
     *
     * @return list<array<string, mixed>>
     */
    public function clientErrors(): array
    {
        return array_values($this->validated('errors'));
    }
}
