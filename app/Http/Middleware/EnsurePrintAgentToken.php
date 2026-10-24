<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards the print agent's machine endpoints (Web POS & Print Bridge → E): the request's
 * `X-Print-Agent-Token` must equal `PRINT_AGENT_TOKEN` (compared in constant time).
 *
 * - `PRINT_AGENT_TOKEN` unset or empty → `503 "The print agent is not configured."`;
 * - a missing or wrong token → `401 "Invalid print agent token."`.
 */
class EnsurePrintAgentToken
{
    public const HEADER = 'X-Print-Agent-Token';

    public const MESSAGE_NOT_CONFIGURED = 'The print agent is not configured.';

    public const MESSAGE_INVALID = 'Invalid print agent token.';

    /**
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $expected = config('pos.print_agent.token');

        if (! is_string($expected) || $expected === '') {
            return response()->json(['message' => self::MESSAGE_NOT_CONFIGURED], 503);
        }

        $given = $request->header(self::HEADER);

        if (! is_string($given) || ! hash_equals($expected, $given)) {
            return response()->json(['message' => self::MESSAGE_INVALID], 401);
        }

        return $next($request);
    }
}
