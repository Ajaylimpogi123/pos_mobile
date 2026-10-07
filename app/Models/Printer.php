<?php

namespace App\Models;

use Database\Factories\PrinterFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A network thermal printer of a branch (Phase 4): raw ESC/POS over TCP, printed to
 * directly by the tablet. Branch-scoped master data, soft-deleted. Written only by the
 * actions in App\Actions\Printing.
 *
 * @property int $id
 * @property int $branch_id
 * @property string $name
 * @property string $role
 * @property string $host
 * @property int $port
 * @property int $paper_width_mm
 * @property bool $is_enabled
 * @property bool $is_default_kitchen
 */
#[Fillable(['name', 'role', 'host', 'port', 'paper_width_mm', 'is_enabled', 'is_default_kitchen'])]
class Printer extends Model
{
    /** @use HasFactory<PrinterFactory> */
    use HasFactory, SoftDeletes;

    public const ROLE_CASHIER = 'cashier';

    public const ROLE_KITCHEN = 'kitchen';

    public const ROLE_BAR = 'bar';

    public const ROLES = [self::ROLE_CASHIER, self::ROLE_KITCHEN, self::ROLE_BAR];

    /**
     * Roles that print tickets (and may take categories and be the default kitchen printer).
     */
    public const TICKET_ROLES = [self::ROLE_KITCHEN, self::ROLE_BAR];

    public const PAPER_WIDTHS = [58, 80];

    public const DEFAULT_PORT = 9100;

    public const DEFAULT_PAPER_WIDTH_MM = 80;

    /**
     * The most non-deleted printers a branch may have.
     */
    public const MAX_PER_BRANCH = 20;

    /**
     * Defaults (mirroring the migration) so a new model is complete before it is saved.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'port' => self::DEFAULT_PORT,
        'paper_width_mm' => self::DEFAULT_PAPER_WIDTH_MM,
        'is_enabled' => true,
        'is_default_kitchen' => false,
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'branch_id' => 'integer',
            'port' => 'integer',
            'paper_width_mm' => 'integer',
            'is_enabled' => 'boolean',
            'is_default_kitchen' => 'boolean',
        ];
    }

    /**
     * Whether the printer prints kitchen or bar tickets (not receipts).
     */
    public function printsTickets(): bool
    {
        return in_array($this->role, self::TICKET_ROLES, true);
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    /**
     * Every route row of the printer, including routes to soft-deleted categories.
     *
     * @return HasMany<PrintRoute, $this>
     */
    public function routes(): HasMany
    {
        return $this->hasMany(PrintRoute::class);
    }

    /**
     * The non-deleted categories routed to this printer (soft-deleted categories are
     * left out by Category's soft-delete scope).
     *
     * @return BelongsToMany<Category, $this>
     */
    public function categories(): BelongsToMany
    {
        return $this->belongsToMany(Category::class, 'print_routes');
    }

    /**
     * The contract's `category_ids`: the non-deleted routed categories, ascending. Uses
     * the `categories` relation when it is loaded.
     *
     * @return list<int>
     */
    public function routedCategoryIds(): array
    {
        $ids = $this->relationLoaded('categories')
            ? $this->categories->pluck('id')
            : $this->categories()->pluck('categories.id');

        return $ids->map(fn ($id) => (int) $id)->sort()->values()->all();
    }
}
