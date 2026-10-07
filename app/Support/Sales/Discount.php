<?php

namespace App\Support\Sales;

use App\Support\Money;
use InvalidArgumentException;

/**
 * A line or order discount as sent by the client (Phase 3 contract, *Discount rules*):
 * `percent` values are basis points (1–10000), `amount` values are centavos
 * (1–1000000000). Only promo, employee and manual exist: SC/PWD is not a discount type, it
 * goes through `sc_pwd` (App\Support\Sales\ScPwd).
 */
final class Discount
{
    public const TYPES = ['promo', 'employee', 'manual'];

    public const KIND_PERCENT = 'percent';

    public const KIND_AMOUNT = 'amount';

    public const KINDS = [self::KIND_PERCENT, self::KIND_AMOUNT];

    public const MAX_PERCENT_BPS = 10000;

    public const MAX_AMOUNT_CENTS = 1000000000;

    public function __construct(
        public readonly string $type,
        public readonly string $kind,
        public readonly int $value,
    ) {
        if (! in_array($kind, self::KINDS, true)) {
            throw new InvalidArgumentException("Unknown discount kind [{$kind}].");
        }

        if ($value < 1) {
            throw new InvalidArgumentException('A discount value must be at least 1.');
        }
    }

    /**
     * @param  array{type?: mixed, kind?: mixed, value?: mixed}|null  $data  A validated discount object, or null
     */
    public static function fromArray(?array $data): ?self
    {
        if ($data === null) {
            return null;
        }

        return new self((string) $data['type'], (string) $data['kind'], (int) $data['value']);
    }

    /**
     * The discount in centavos on the given base. `percent`: `rhu(base × value, 10000)`;
     * `amount`: the value itself. The result may exceed the base: the caller checks.
     */
    public function amountOn(int $baseCents): int
    {
        return $this->kind === self::KIND_PERCENT
            ? Money::roundHalfUp($baseCents * $this->value, 10000)
            : $this->value;
    }

    /**
     * The discount as sent: `{type, kind, value}`.
     *
     * @return array{type: string, kind: string, value: int}
     */
    public function toArray(): array
    {
        return ['type' => $this->type, 'kind' => $this->kind, 'value' => $this->value];
    }
}
