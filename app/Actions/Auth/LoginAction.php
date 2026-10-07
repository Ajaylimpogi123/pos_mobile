<?php

namespace App\Actions\Auth;

use App\Actions\Audit\RecordAuditLog;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Authenticates a staff member by email + password and issues a new
 * Sanctum API token. Tokens are not bound to a device, and the user's
 * other tokens (e.g. on another phone) are left alone.
 *
 * Checks run in the contract's order; the first failure wins:
 * unknown email or wrong password → 401, deactivated user → 403.
 */
class LoginAction
{
    public const MESSAGE_INVALID_CREDENTIALS = 'Invalid email or password.';

    public const MESSAGE_DEACTIVATED = 'This account has been deactivated.';

    public function __construct(
        private readonly RecordAuditLog $recordAuditLog,
        private readonly IssueSessionToken $issueSessionToken,
    ) {}

    /**
     * @throws HttpResponseException 401 on bad credentials, 403 on a deactivated account
     */
    public function execute(string $email, string $password, ?string $ip = null): LoginResult
    {
        // Soft-deleted users are excluded by the SoftDeletes scope, so they fail as "unknown".
        $user = User::query()->where('email', Str::lower($email))->first();

        if ($user === null) {
            // Spend comparable time to a real check so response timing does not reveal which emails exist.
            Hash::make($password);

            $this->fail(401, self::MESSAGE_INVALID_CREDENTIALS);
        }

        if (! Hash::check($password, $user->password)) {
            $this->fail(401, self::MESSAGE_INVALID_CREDENTIALS);
        }

        if (! $user->is_active) {
            $this->fail(403, self::MESSAGE_DEACTIVATED);
        }

        return DB::transaction(function () use ($user, $ip): LoginResult {
            $token = $this->issueSessionToken->execute($user);

            $this->recordAuditLog->execute(
                action: 'auth.login',
                actor: $user,
                subject: $user,
                changes: [
                    'token_id' => $token->accessToken->getKey(),
                    'token_name' => $token->accessToken->name,
                    'expires_at' => $token->accessToken->expires_at?->toIso8601ZuluString(),
                ],
                ip: $ip,
            );

            return new LoginResult($user, $token);
        });
    }

    /**
     * Abort with the contract's exact login error body: `{ "message": "..." }`, no `errors` key.
     * Deliberately not an AuthenticationException, which would render "Unauthenticated.".
     *
     * @throws HttpResponseException
     */
    private function fail(int $status, string $message): never
    {
        throw new HttpResponseException(response()->json(['message' => $message], $status));
    }
}
