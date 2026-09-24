<?php

namespace App\Actions\Auth;

use App\Actions\Audit\RecordAuditLog;
use App\Models\Device;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Authenticates a staff member on a registered device and issues a
 * device-bound Sanctum token.
 *
 * Checks run in the contract's order; the first failure wins (422).
 */
class LoginAction
{
    public const MESSAGE_BAD_CREDENTIALS = 'These credentials do not match our records.';

    public const MESSAGE_DEACTIVATED = 'This account has been deactivated.';

    public const MESSAGE_DEVICE_NOT_REGISTERED = 'This device is not registered.';

    public const MESSAGE_DEVICE_WRONG_BRANCH = 'This device is not registered to your branch.';

    public function __construct(private readonly RecordAuditLog $recordAuditLog) {}

    /**
     * @throws ValidationException
     */
    public function execute(
        string $email,
        string $password,
        string $deviceCode,
        ?string $appVersion = null,
        ?string $ip = null,
    ): LoginResult {
        $user = User::query()->where('email', Str::lower($email))->first();

        if ($user === null) {
            // Spend comparable time to a real check so response timing does not reveal which emails exist.
            Hash::make($password);

            throw ValidationException::withMessages(['email' => self::MESSAGE_BAD_CREDENTIALS]);
        }

        if (! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages(['email' => self::MESSAGE_BAD_CREDENTIALS]);
        }

        if (! $user->is_active) {
            throw ValidationException::withMessages(['email' => self::MESSAGE_DEACTIVATED]);
        }

        $device = Device::query()
            ->where('code', Str::upper($deviceCode))
            ->where('is_active', true)
            ->first();

        if ($device === null) {
            throw ValidationException::withMessages(['device_code' => self::MESSAGE_DEVICE_NOT_REGISTERED]);
        }

        if ((int) $device->branch_id !== (int) $user->branch_id) {
            throw ValidationException::withMessages(['device_code' => self::MESSAGE_DEVICE_WRONG_BRANCH]);
        }

        return DB::transaction(function () use ($user, $device, $appVersion, $ip): LoginResult {
            $now = now();

            // One live session per user per device: revoke any older tokens on this device.
            $user->tokens()->where('device_id', $device->getKey())->delete();

            $token = $user->createDeviceToken(
                $device,
                $now->copy()->addHours((int) config('pos.auth_token_ttl_hours', 24)),
            );

            // A login is not a profile edit, so it must not bump users.updated_at (used for delta sync).
            User::withoutTimestamps(fn () => $user->forceFill(['last_login_at' => $now])->save());

            $device->forceFill(array_filter([
                'last_seen_at' => $now,
                'app_version' => $appVersion,
            ], fn ($value) => $value !== null))->save();

            $this->recordAuditLog->execute(
                action: 'auth.login',
                actor: $user,
                subject: $device,
                changes: [
                    'token_id' => $token->accessToken->getKey(),
                    'device_code' => $device->code,
                    'app_version' => $appVersion,
                ],
                ip: $ip,
            );

            $user->withAccessToken($token->accessToken);
            $user->loadMissing(['role.permissions', 'branch']);

            return new LoginResult($user, $token);
        });
    }
}
