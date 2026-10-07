<?php

namespace App\Support;

use Carbon\CarbonInterface;
use InvalidArgumentException;
use JsonException;

/**
 * The opaque, versioned cursor of GET /api/v1/sync/catalogue (Phase 2).
 *
 * Encoded as URL-safe base64 (no padding) of a compact JSON object. All times are
 * UTC unix seconds, matching the second-precision `updated_at` columns.
 *
 * | Key | Meaning |
 * |---|---|
 * | `v` | Format version ({@see self::VERSION}) |
 * | `f` | The run is a baseline (it started without a cursor) |
 * | `r` | The run's restart point: rows with `updated_at >= r`. `null` = from the beginning |
 * | `t` | When the run started. `null` = this cursor starts a new run |
 * | `n` | The newest `updated_at` seen so far in the run, or `null` |
 * | `c`, `p` | Keyset position `[updated_at, id]` of the last category / product sent in the run, or `null` |
 *
 * A cursor issued on the last page of a run carries only `r` (with `t`, `n`, `c`, `p`
 * null). A cursor issued mid-run carries the whole run state.
 */
final class SyncCursor
{
    public const VERSION = 1;

    /**
     * @param  array{0: int, 1: int}|null  $categories
     * @param  array{0: int, 1: int}|null  $products
     */
    private function __construct(
        public readonly bool $full,
        public readonly ?int $since,
        public readonly ?int $runStartedAt,
        public readonly ?int $newest,
        public readonly ?array $categories,
        public readonly ?array $products,
    ) {}

    /**
     * The cursor that starts the next run (a delta) at the given restart point.
     */
    public static function nextRun(?int $since): self
    {
        return new self(false, $since, null, null, null, null);
    }

    /**
     * A cursor that continues the current run on the next page.
     *
     * @param  array{0: int, 1: int}|null  $categories
     * @param  array{0: int, 1: int}|null  $products
     */
    public static function continueRun(
        bool $full,
        ?int $since,
        int $runStartedAt,
        ?int $newest,
        ?array $categories,
        ?array $products,
    ): self {
        return new self($full, $full ? null : $since, $runStartedAt, $newest, $categories, $products);
    }

    /**
     * Whether this cursor starts a new run (it was issued on the last page of a run).
     */
    public function startsRun(): bool
    {
        return $this->runStartedAt === null;
    }

    /**
     * Whether the cursor points after the given time (it was not issued by this server clock).
     */
    public function isAfter(CarbonInterface $now): bool
    {
        $now = $now->getTimestamp();

        return ($this->since !== null && $this->since > $now)
            || ($this->runStartedAt !== null && $this->runStartedAt > $now);
    }

    public function encode(): string
    {
        $json = json_encode([
            'v' => self::VERSION,
            'f' => $this->full,
            'r' => $this->since,
            't' => $this->runStartedAt,
            'n' => $this->newest,
            'c' => $this->categories,
            'p' => $this->products,
        ], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    /**
     * @throws InvalidArgumentException when the cursor cannot be decoded or has an unknown version
     */
    public static function decode(string $encoded): self
    {
        if ($encoded === '' || preg_match('/^[A-Za-z0-9_-]+$/', $encoded) !== 1) {
            throw new InvalidArgumentException('The cursor is not URL-safe base64.');
        }

        $json = base64_decode(strtr($encoded, '-_', '+/'), true);

        if ($json === false) {
            throw new InvalidArgumentException('The cursor is not valid base64.');
        }

        try {
            $data = json_decode($json, true, 4, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new InvalidArgumentException('The cursor is not valid JSON.');
        }

        if (! is_array($data) || array_is_list($data) || ($data['v'] ?? null) !== self::VERSION) {
            throw new InvalidArgumentException('The cursor has an unknown version.');
        }

        if (array_keys($data) !== ['v', 'f', 'r', 't', 'n', 'c', 'p'] || ! is_bool($data['f'])) {
            throw new InvalidArgumentException('The cursor is malformed.');
        }

        $since = self::nullableTimestamp($data['r']);
        $runStartedAt = self::nullableTimestamp($data['t']);
        $newest = self::nullableTimestamp($data['n']);
        $categories = self::position($data['c']);
        $products = self::position($data['p']);

        // A new-run cursor carries only the restart point; a baseline never has one.
        $startsRun = $runStartedAt === null;

        if ($startsRun && ($data['f'] || $newest !== null || $categories !== null || $products !== null)) {
            throw new InvalidArgumentException('The cursor is malformed.');
        }

        if ($data['f'] && $since !== null) {
            throw new InvalidArgumentException('The cursor is malformed.');
        }

        return new self($data['f'], $since, $runStartedAt, $newest, $categories, $products);
    }

    private static function nullableTimestamp(mixed $value): ?int
    {
        if ($value === null) {
            return null;
        }

        if (! is_int($value) || $value < 0) {
            throw new InvalidArgumentException('The cursor is malformed.');
        }

        return $value;
    }

    /**
     * @return array{0: int, 1: int}|null
     */
    private static function position(mixed $value): ?array
    {
        if ($value === null) {
            return null;
        }

        if (! is_array($value) || ! array_is_list($value) || count($value) !== 2
            || ! is_int($value[0]) || $value[0] < 0 || ! is_int($value[1]) || $value[1] < 1) {
            throw new InvalidArgumentException('The cursor is malformed.');
        }

        return [$value[0], $value[1]];
    }
}
