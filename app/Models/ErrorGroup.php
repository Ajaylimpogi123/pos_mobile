<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One distinct error of the app or the server (Hardening & Pilot → B), keyed by its
 * fingerprint. Written only by App\Actions\Errors\RecordErrorOccurrence and the
 * resolve / reopen actions.
 *
 * @property int $id
 * @property string $fingerprint
 * @property string $source
 * @property string $level
 * @property string $message
 * @property Carbon $first_seen_at
 * @property Carbon $last_seen_at
 * @property int $occurrences
 * @property string $status
 * @property Carbon|null $resolved_at
 * @property int|null $resolved_by
 * @property list<string>|null $app_versions
 */
class ErrorGroup extends Model
{
    public const SOURCE_APP = 'app';

    public const SOURCE_SERVER = 'server';

    public const SOURCES = [self::SOURCE_APP, self::SOURCE_SERVER];

    public const LEVELS = ['warning', 'error', 'fatal'];

    public const STATUS_OPEN = 'open';

    public const STATUS_RESOLVED = 'resolved';

    public const STATUSES = [self::STATUS_OPEN, self::STATUS_RESOLVED];

    /** The distinct app versions kept on a group. */
    public const MAX_APP_VERSIONS = 5;

    protected $guarded = ['id'];

    /**
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => self::STATUS_OPEN,
        'occurrences' => 0,
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'first_seen_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'occurrences' => 'integer',
            'resolved_at' => 'datetime',
            'resolved_by' => 'integer',
            'app_versions' => 'array',
        ];
    }

    /**
     * @return HasMany<ErrorEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(ErrorEvent::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function resolver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by')->withTrashed();
    }
}
