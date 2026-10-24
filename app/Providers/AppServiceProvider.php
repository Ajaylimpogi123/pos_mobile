<?php

namespace App\Providers;

use App\Actions\Errors\ErrorLogQuery;
use App\Models\Device;
use App\Models\DiningTable;
use App\Models\ErrorGroup;
use App\Models\PersonalAccessToken;
use App\Models\Printer;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequest;
use App\Models\User;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        // A soft-deleted (or removed) user's token resolves no tokenable, so Sanctum
        // rejects it before `session.active` runs. Revoke it here, so that restoring
        // the user never brings the old session back. Deactivated users are handled
        // by EnsureSessionIsActive.
        Sanctum::authenticateAccessTokensUsing(function (PersonalAccessToken $token, bool $isValid): bool {
            if ($token->tokenable === null) {
                $token->delete();

                return false;
            }

            return $isValid;
        });

        // Staff routes (`/admin/users/{user}`): resolve only users of the caller's branch,
        // so a user in another branch (or soft-deleted) is a 404 on every staff endpoint.
        // auth:sanctum runs before bindings, so the caller is known here.
        Route::bind('user', function (string $value): User {
            $caller = request()->user();

            return User::query()
                ->where('branch_id', $caller instanceof User ? $caller->branch_id : null)
                ->whereKey($value)
                ->firstOrFail();
        });

        // Printer routes (`/admin/printers/{printer}`, Phase 4): resolve only non-deleted
        // printers of the caller's branch, so another branch's printer is a 404.
        Route::bind('printer', function (string $value): Printer {
            $caller = request()->user();

            return Printer::query()
                ->where('branch_id', $caller instanceof User ? $caller->branch_id : null)
                ->whereKey($value)
                ->firstOrFail();
        });

        // Admin tables (`/admin/tables/{diningTable}`, Dine-in Tables & Tabs → B): resolve only
        // non-deleted tables of the caller's branch, so another branch's table is a 404.
        Route::bind('diningTable', fn (string $value): DiningTable => DiningTable::query()
            ->where('branch_id', $this->callerBranchId())
            ->whereKey($value)
            ->firstOrFail());

        // Purchasing routes (`/purchase-requests/{purchaseRequest}`, `/purchase-orders/{purchaseOrder}`;
        // Ingredients, Recipes & Purchasing): resolve by ULID within the caller's branch only, so
        // another branch's PR or PO is a 404.
        Route::bind('purchaseRequest', fn (string $value): PurchaseRequest => PurchaseRequest::query()
            ->where('branch_id', $this->callerBranchId())
            ->where('ulid', $value)
            ->firstOrFail());

        Route::bind('purchaseOrder', fn (string $value): PurchaseOrder => PurchaseOrder::query()
            ->where('branch_id', $this->callerBranchId())
            ->where('ulid', $value)
            ->firstOrFail());

        // Admin Devices (`/admin/devices/{device}`, Hardening & Pilot → C): resolve only the
        // caller's branch devices (retired included), so another branch's device is a 404. The
        // single-device read (Q-043) also resolves any branch's device for a `branch.all` holder.
        Route::bind('device', function (string $value): Device {
            $caller = request()->user();
            $anyBranch = $caller instanceof User
                && request()->route()?->getName() === 'v1.admin.devices.show'
                && $caller->hasPermission('branch.all');

            return Device::query()
                ->when(! $anyBranch, fn ($query) => $query->where('branch_id', $this->callerBranchId()))
                ->whereKey(ctype_digit($value) ? (int) $value : 0)
                ->firstOrFail();
        });

        // The error log (`/admin/error-log/{errorGroup}`, Hardening & Pilot → B): only a group
        // the caller can see (ErrorLogQuery), otherwise a 404.
        Route::bind('errorGroup', function (string $value): ErrorGroup {
            $caller = request()->user();

            return ($caller instanceof User ? app(ErrorLogQuery::class)->findVisible($caller, $value) : null)
                ?? throw (new ModelNotFoundException)->setModel(ErrorGroup::class, [$value]);
        });

        // POST /api/v1/client-errors (Hardening & Pilot → B): 30 requests per minute per IP.
        RateLimiter::for('client-errors', fn (Request $request) => Limit::perMinute(30)->by((string) $request->ip()));

        // GET /api/v1/app-version (Hardening & Pilot → C): 60 per minute per IP.
        RateLimiter::for('app-version', fn (Request $request) => Limit::perMinute(60)->by((string) $request->ip()));

        // POST /api/v1/auth/login: 5 attempts per minute per email + IP.
        RateLimiter::for('login', function (Request $request) {
            $email = $request->input('email');

            return Limit::perMinute(5)
                ->by(Str::lower(is_string($email) ? $email : '').'|'.$request->ip());
        });

        // The print agent's endpoints (/api/v1/print-agent/*, Web POS → E): 120 per minute per IP,
        // counted before the token check so a wrong token can't be guessed quickly.
        RateLimiter::for('print-agent', fn (Request $request) => Limit::perMinute(120)->by((string) $request->ip()));
    }

    /**
     * The authenticated caller's branch (auth:sanctum runs before bindings), or null.
     */
    private function callerBranchId(): ?int
    {
        $caller = request()->user();

        return $caller instanceof User ? $caller->branch_id : null;
    }
}
