<?php

namespace App\Actions\Sync;

use App\Models\Order;

/**
 * The outcome of one submitted offline order (POST /api/v1/sync/orders): `accepted` or
 * `duplicate` with the stored order, or `rejected` with the reason.
 */
final class OfflineOrderResult
{
    public const ACCEPTED = 'accepted';

    public const DUPLICATE = 'duplicate';

    public const REJECTED = 'rejected';

    private function __construct(
        public readonly ?string $ulid,
        public readonly string $status,
        public readonly ?Order $order,
        public readonly ?string $message,
    ) {}

    public static function accepted(Order $order): self
    {
        return new self($order->ulid, self::ACCEPTED, $order, null);
    }

    public static function duplicate(Order $order): self
    {
        return new self($order->ulid, self::DUPLICATE, $order, null);
    }

    /**
     * @param  string|null  $ulid  The ULID as submitted (null when it was not a string)
     */
    public static function rejected(?string $ulid, string $message): self
    {
        return new self($ulid, self::REJECTED, null, $message);
    }
}
