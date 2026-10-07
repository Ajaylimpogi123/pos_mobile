<?php

namespace App\Support\Sales;

use InvalidArgumentException;

/**
 * The Senior Citizen / PWD entitlement of a sale, as sent in `sc_pwd` (SC/PWD contract):
 *
 * - `items` mode: the lines marked `sc_pwd` are the eligible part;
 * - `headcount` mode (a shared meal): the eligible part is `subtotal ÷ diners × persons`.
 *
 * With `vatExempt`, the 12% VAT is removed from the eligible part before the 20% discount,
 * and that part is VAT-exempt. It is a legal entitlement, never a discretionary discount:
 * it never needs approval.
 */
final class ScPwd
{
    public const MODE_ITEMS = 'items';

    public const MODE_HEADCOUNT = 'headcount';

    public const MODES = [self::MODE_ITEMS, self::MODE_HEADCOUNT];

    public const TYPE_SENIOR_CITIZEN = 'senior_citizen';

    public const TYPE_PWD = 'pwd';

    public const TYPES = [self::TYPE_SENIOR_CITIZEN, self::TYPE_PWD];

    public const MAX_PERSONS = 10;

    public const MAX_DINERS = 100;

    /**
     * @param  list<array{type: string, id_no: string}>  $persons
     * @param  int|null  $diners  `headcount` mode only
     */
    public function __construct(
        public readonly string $mode,
        public readonly array $persons,
        public readonly ?int $diners,
        public readonly bool $vatExempt,
    ) {
        if (! in_array($mode, self::MODES, true)) {
            throw new InvalidArgumentException("Unknown SC/PWD mode [{$mode}].");
        }

        if ($persons === []) {
            throw new InvalidArgumentException('An SC/PWD discount needs at least one person.');
        }

        if ($mode === self::MODE_HEADCOUNT && ($diners === null || $diners < count($persons))) {
            throw new InvalidArgumentException('A shared meal needs at least as many diners as SC/PWD persons.');
        }

        if ($mode === self::MODE_ITEMS && $diners !== null) {
            throw new InvalidArgumentException('The diners only apply to a shared meal.');
        }
    }

    /**
     * @param  array<string, mixed>|null  $data  A validated `sc_pwd` object, or null
     */
    public static function fromArray(?array $data): ?self
    {
        if ($data === null || $data === []) {
            return null;
        }

        return new self(
            mode: (string) $data['mode'],
            persons: array_map(fn (array $person) => [
                'type' => (string) $person['type'],
                'id_no' => (string) $person['id_no'],
            ], array_values($data['persons'])),
            diners: isset($data['diners']) ? (int) $data['diners'] : null,
            vatExempt: (bool) $data['vat_exempt'],
        );
    }

    public function personsCount(): int
    {
        return count($this->persons);
    }

    public function isHeadcount(): bool
    {
        return $this->mode === self::MODE_HEADCOUNT;
    }
}
