<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Setting;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * A branch's settings (Phase 4: the receipt settings) with the defaults filled in.
 *
 * Saved values live in `settings` (`branch_id`, `key`, JSON `value`); a key with no row,
 * or with a stored value of the wrong type, uses its default. The default header lines
 * are built from the branch: its `name`, its `address` split on line breaks, and
 * `TIN <tin>`, skipping empty values. `updated_at` is the latest save of any key, or
 * null until the settings are first saved.
 */
final class BranchSettings
{
    public const RECEIPT_HEADER_LINES = 'receipt_header_lines';

    public const RECEIPT_FOOTER_LINES = 'receipt_footer_lines';

    public const AUTO_PRINT_RECEIPT = 'auto_print_receipt';

    public const RECEIPT_COPIES = 'receipt_copies';

    public const PRINT_KITCHEN_TICKETS = 'print_kitchen_tickets';

    /**
     * Dine-in Tables & Tabs → A: the Tables view and the tab endpoints are on.
     */
    public const DINE_IN_ENABLED = 'dine_in_enabled';

    /**
     * Dine-in: the service charge of tab settlements, in basis points (0 = none).
     */
    public const SERVICE_CHARGE_BPS = 'service_charge_bps';

    public const MAX_SERVICE_CHARGE_BPS = 2000;

    /**
     * Every key, in the contract's order.
     */
    public const KEYS = [
        self::RECEIPT_HEADER_LINES,
        self::RECEIPT_FOOTER_LINES,
        self::AUTO_PRINT_RECEIPT,
        self::RECEIPT_COPIES,
        self::PRINT_KITCHEN_TICKETS,
        self::DINE_IN_ENABLED,
        self::SERVICE_CHARGE_BPS,
    ];

    public const DEFAULT_FOOTER_LINES = ['This is not an official receipt.'];

    public const MAX_LINES = 6;

    public const MAX_LINE_LENGTH = 48;

    public const MIN_COPIES = 1;

    public const MAX_COPIES = 3;

    /**
     * @param  array<string, mixed>  $values  Every key, typed, defaults filled in
     */
    private function __construct(
        private readonly array $values,
        private readonly ?CarbonInterface $updatedAt,
    ) {}

    /**
     * The branch's settings (one query).
     */
    public static function for(Branch $branch): self
    {
        $rows = Setting::query()
            ->where('branch_id', $branch->id)
            ->whereIn('key', self::KEYS)
            ->get(['key', 'value', 'updated_at'])
            ->keyBy('key');

        $defaults = self::defaults($branch);
        $values = [];

        foreach (self::KEYS as $key) {
            $row = $rows->get($key);
            $values[$key] = $row !== null ? self::typed($key, $row->value, $defaults[$key]) : $defaults[$key];
        }

        $latest = $rows->max(fn (Setting $row) => $row->updated_at?->getTimestamp());

        return new self($values, $latest === null ? null : CarbonImmutable::createFromTimestampUTC($latest));
    }

    /**
     * The values a branch uses when nothing was saved.
     *
     * @return array<string, mixed>
     */
    public static function defaults(Branch $branch): array
    {
        return [
            self::RECEIPT_HEADER_LINES => self::defaultHeaderLines($branch),
            self::RECEIPT_FOOTER_LINES => self::DEFAULT_FOOTER_LINES,
            self::AUTO_PRINT_RECEIPT => true,
            self::RECEIPT_COPIES => 1,
            self::PRINT_KITCHEN_TICKETS => true,
            self::DINE_IN_ENABLED => false,
            self::SERVICE_CHARGE_BPS => 0,
        ];
    }

    /**
     * The branch's name, its address lines and `TIN <tin>`, skipping empty values.
     *
     * @return list<string>
     */
    public static function defaultHeaderLines(Branch $branch): array
    {
        $lines = [trim((string) $branch->name)];

        foreach (preg_split('/\R/u', (string) $branch->address) ?: [] as $addressLine) {
            $lines[] = trim($addressLine);
        }

        $tin = trim((string) $branch->tin);
        $lines[] = $tin === '' ? '' : "TIN {$tin}";

        return array_values(array_filter($lines, fn (string $line) => $line !== ''));
    }

    /**
     * A value as stored/returned for a key: lines as a list of strings, flags as booleans,
     * copies as an integer. A value of the wrong type falls back to the default.
     */
    public static function typed(string $key, mixed $value, mixed $default): mixed
    {
        return match ($key) {
            self::RECEIPT_HEADER_LINES, self::RECEIPT_FOOTER_LINES => is_array($value)
                && array_filter($value, fn ($line) => ! is_string($line)) === []
                    ? array_values($value)
                    : $default,
            self::AUTO_PRINT_RECEIPT, self::PRINT_KITCHEN_TICKETS, self::DINE_IN_ENABLED => is_bool($value) ? $value : $default,
            self::SERVICE_CHARGE_BPS => is_int($value) && $value >= 0 && $value <= self::MAX_SERVICE_CHARGE_BPS ? $value : $default,
            self::RECEIPT_COPIES => is_int($value) && $value >= self::MIN_COPIES && $value <= self::MAX_COPIES ? $value : $default,
            default => $value,
        };
    }

    /**
     * @return list<string>
     */
    public function receiptHeaderLines(): array
    {
        return $this->values[self::RECEIPT_HEADER_LINES];
    }

    /**
     * @return list<string>
     */
    public function receiptFooterLines(): array
    {
        return $this->values[self::RECEIPT_FOOTER_LINES];
    }

    public function autoPrintReceipt(): bool
    {
        return $this->values[self::AUTO_PRINT_RECEIPT];
    }

    public function receiptCopies(): int
    {
        return $this->values[self::RECEIPT_COPIES];
    }

    public function printKitchenTickets(): bool
    {
        return $this->values[self::PRINT_KITCHEN_TICKETS];
    }

    public function dineInEnabled(): bool
    {
        return $this->values[self::DINE_IN_ENABLED];
    }

    public function serviceChargeBps(): int
    {
        return $this->values[self::SERVICE_CHARGE_BPS];
    }

    public function get(string $key): mixed
    {
        return $this->values[$key];
    }

    /**
     * Every key with its value, in the contract's order.
     *
     * @return array<string, mixed>
     */
    public function all(): array
    {
        return $this->values;
    }

    public function updatedAt(): ?CarbonInterface
    {
        return $this->updatedAt;
    }
}
