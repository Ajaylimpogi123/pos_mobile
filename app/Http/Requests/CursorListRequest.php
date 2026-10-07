<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Shared query handling for cursor-paginated list endpoints:
 * `per_page` (1–100), `cursor`, an optional `search`, and boolean filters.
 */
abstract class CursorListRequest extends FormRequest
{
    /**
     * The page size used when `per_page` is not sent.
     */
    public const DEFAULT_PER_PAGE = 25;

    /**
     * Query parameters that are boolean filters. Query strings cannot carry JSON
     * booleans, so `true`/`false` are accepted alongside `1`/`0`.
     *
     * @var list<string>
     */
    protected array $booleanFilters = [];

    /**
     * Endpoint-specific rules, merged with `per_page` and `cursor`.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    abstract protected function filterRules(): array;

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'cursor' => ['sometimes', 'string'],
            ...$this->filterRules(),
        ];
    }

    protected function prepareForValidation(): void
    {
        foreach ($this->booleanFilters as $key) {
            $value = $this->query($key);

            if (is_string($value) && in_array(strtolower($value), ['true', 'false'], true)) {
                $this->merge([$key => strtolower($value) === 'true' ? '1' : '0']);
            }
        }
    }

    public function perPage(): int
    {
        return (int) $this->validated('per_page', static::DEFAULT_PER_PAGE);
    }

    public function search(): ?string
    {
        $search = trim((string) $this->validated('search', ''));

        return $search === '' ? null : $search;
    }

    /**
     * A validated integer filter, or null when it was not sent.
     */
    public function integerFilter(string $key): ?int
    {
        $value = $this->validated($key);

        return $value === null ? null : (int) $value;
    }

    /**
     * A validated boolean filter, or null when it was not sent.
     */
    public function booleanFilter(string $key): ?bool
    {
        $value = $this->validated($key);

        return $value === null ? null : filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }
}
