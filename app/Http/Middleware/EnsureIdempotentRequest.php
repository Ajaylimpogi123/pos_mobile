<?php

namespace App\Http\Middleware;

use App\Actions\Idempotency\ClaimIdempotencyKey;
use App\Exceptions\ConflictException;
use App\Models\User;
use App\Support\RequestFingerprint;
use App\Support\Ulid;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * `idempotent`: the Global Conventions' *Idempotent requests*, for endpoints marked
 * **Idempotent: yes**. Runs after authentication (and `session.active`) and before
 * route model binding and validation:
 *
 * 1. Without a well-formed `Idempotency-Key` (a ULID) there is nothing to replay; the
 *    request goes on, and its FormRequest answers 403 or the 422 on `idempotency_key`.
 * 2. Otherwise the key is claimed (ClaimIdempotencyKey): a stored success for the same
 *    endpoint and body is replayed with `Idempotency-Replayed: true`, and a different
 *    request or one still running is a 409.
 * 3. The request runs. A 2xx response is stored against the key; any 4xx or 5xx
 *    releases the key, so the client may correct the request and retry with it.
 *
 * Bodies are compared as a fingerprint that ignores key order and any `pin` field.
 */
class EnsureIdempotentRequest
{
    public function __construct(private readonly ClaimIdempotencyKey $claimKey) {}

    /**
     * @param  Closure(Request): (Response)  $next
     *
     * @throws ConflictException
     */
    public function handle(Request $request, Closure $next): Response
    {
        $key = $request->header('Idempotency-Key');
        $user = $request->user();

        if (! Ulid::isValid($key) || ! $user instanceof User) {
            return $next($request);
        }

        $claim = $this->claimKey->execute(
            key: $key,
            user: $user,
            endpoint: $request->method().' '.$request->path(),
            requestHash: RequestFingerprint::of($request->request->all()),
        );

        if ($claim->replay) {
            return $claim->record->replay();
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $claim->record->delete();

            throw $e;
        }

        if ($response->isSuccessful()) {
            $claim->record->complete($response);
        } else {
            $claim->record->delete();
        }

        return $response;
    }
}
