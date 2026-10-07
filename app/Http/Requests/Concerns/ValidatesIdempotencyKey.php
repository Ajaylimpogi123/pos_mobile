<?php

namespace App\Http\Requests\Concerns;

use App\Rules\IdempotencyKeyHeader;

/**
 * For the FormRequest of an idempotent endpoint: validates the `Idempotency-Key`
 * header as the pseudo-field `idempotency_key` (422 on `errors.idempotency_key`), with
 * the body's other fields. Add {@see self::idempotencyKeyRules()} to `rules()`.
 */
trait ValidatesIdempotencyKey
{
    /**
     * The body plus the header, as `idempotency_key` (the header wins over a body field
     * of that name).
     *
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return [...$this->all(), 'idempotency_key' => $this->header('Idempotency-Key')];
    }

    /**
     * @return array<string, list<mixed>>
     */
    protected function idempotencyKeyRules(): array
    {
        return ['idempotency_key' => [new IdempotencyKeyHeader]];
    }
}
