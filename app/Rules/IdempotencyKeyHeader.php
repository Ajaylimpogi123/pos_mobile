<?php

namespace App\Rules;

use App\Support\Ulid;
use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The `Idempotency-Key` header of an idempotent endpoint, validated as the pseudo-field
 * `idempotency_key` (see App\Http\Requests\Concerns\ValidatesIdempotencyKey): it must
 * be a ULID and, when the body has a `ulid` field, equal it. Implicit, so a missing
 * header fails too.
 */
class IdempotencyKeyHeader implements DataAwareRule, ValidationRule
{
    public const MESSAGE = "The Idempotency-Key header must be a ULID that matches the request's ulid.";

    /**
     * Run even when the header is missing.
     */
    public bool $implicit = true;

    /**
     * @var array<string, mixed>
     */
    private array $data = [];

    /**
     * @param  array<string, mixed>  $data
     */
    public function setData(array $data): static
    {
        $this->data = $data;

        return $this;
    }

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! Ulid::isValid($value)) {
            $fail(self::MESSAGE);

            return;
        }

        if (array_key_exists('ulid', $this->data) && $this->data['ulid'] !== $value) {
            $fail(self::MESSAGE);
        }
    }
}
