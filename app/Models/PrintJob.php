<?php

namespace App\Models;

use Database\Factories\PrintJobFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A web terminal's print job (Web POS & Print Bridge → D): the raw ESC/POS bytes the
 * browser built for one printer, queued until the print agent claims and sends them over
 * TCP (→ E). Tablets never use it: they print directly. Written only by the actions in
 * App\Actions\Printing; pruned 30 days after printing or failing.
 *
 * @property int $id
 * @property string $ulid
 * @property int $branch_id
 * @property int|null $device_id
 * @property int $printer_id
 * @property string $kind
 * @property string|null $order_ulid
 * @property int $copy_no
 * @property bool $is_reprint
 * @property string $payload
 * @property string $status
 * @property int $attempts
 * @property string|null $last_error
 * @property string|null $claimed_by
 * @property Carbon|null $claimed_at
 * @property Carbon|null $printed_at
 * @property int $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
class PrintJob extends Model
{
    /** @use HasFactory<PrintJobFactory> */
    use HasFactory;

    public const KIND_RECEIPT = 'receipt';

    public const KIND_KITCHEN = 'kitchen';

    public const KIND_X_READ = 'x_read';

    public const KIND_Z_READ = 'z_read';

    public const KIND_TEST = 'test';

    public const KINDS = [
        self::KIND_RECEIPT, self::KIND_KITCHEN, self::KIND_X_READ, self::KIND_Z_READ,
        'void_slip', 'kitchen_void', 'refund_slip', self::KIND_TEST,
        // Dine-in Tables & Tabs → F: a tab's bill (receipt printer).
        'bill',
    ];

    /**
     * Kinds that print no order (no `order_ulid` needed) and are never deduplicated.
     */
    public const KINDS_WITHOUT_ORDER = [self::KIND_X_READ, self::KIND_Z_READ, self::KIND_TEST];

    public const STATUS_QUEUED = 'queued';

    public const STATUS_PRINTING = 'printing';

    public const STATUS_PRINTED = 'printed';

    public const STATUS_FAILED = 'failed';

    /**
     * Every column but the payload, for the user endpoints (the resource never shows it).
     */
    public const SUMMARY_COLUMNS = [
        'id', 'ulid', 'branch_id', 'device_id', 'printer_id', 'kind', 'order_ulid', 'copy_no',
        'is_reprint', 'status', 'attempts', 'last_error', 'claimed_by', 'claimed_at',
        'printed_at', 'created_by', 'created_at', 'updated_at',
    ];

    /**
     * The decoded payload limit (bytes) of POST /print-jobs.
     */
    public const MAX_PAYLOAD_BYTES = 65536;

    /**
     * Attempts after which a retryable failure stops going back to the queue.
     */
    public const MAX_ATTEMPTS = 3;

    /**
     * Seconds after which a `printing` job of a silent (crashed) agent may be claimed again.
     */
    public const STALE_CLAIM_SECONDS = 60;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'copy_no' => 1,
        'is_reprint' => false,
        'status' => self::STATUS_QUEUED,
        'attempts' => 0,
    ];

    /**
     * @var list<string>
     */
    protected $hidden = ['payload'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'device_id' => 'integer',
            'printer_id' => 'integer',
            'copy_no' => 'integer',
            'is_reprint' => 'boolean',
            'attempts' => 'integer',
            'claimed_at' => 'datetime',
            'printed_at' => 'datetime',
            'created_by' => 'integer',
        ];
    }

    /**
     * The printer, including a soft-deleted one (the resource still shows its name).
     *
     * @return BelongsTo<Printer, $this>
     */
    public function printer(): BelongsTo
    {
        return $this->belongsTo(Printer::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }
}
