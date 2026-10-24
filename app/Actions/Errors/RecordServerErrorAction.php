<?php

namespace App\Actions\Errors;

use App\Models\ErrorGroup;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * Server-side errors in the error log (Hardening & Pilot → B): every unhandled exception that
 * yields a 5xx is recorded with `source: server`, `level: error`:
 * - the message `Class: message` and the top frames (file:line and function, never the
 *   arguments; max 16000);
 * - the route name and method (in `context.extra`), the user id and the device id.
 *
 * It never records request input, headers or the query string: a database error records its
 * SQL with the `?` placeholders, never the bound values. A deliberate HTTP error other than 500
 * (such as a 503 from `abort()`) isn't recorded. Recording fails silently and never changes
 * the response.
 */
class RecordServerErrorAction
{
    private const MAX_FRAMES = 40;

    public function __construct(private readonly RecordErrorOccurrence $record) {}

    public function execute(Throwable $e, Request $request, int $status): void
    {
        try {
            if ($status < 500 || ($e instanceof HttpExceptionInterface && $e->getStatusCode() !== 500)) {
                return;
            }

            $user = Auth::hasUser() ? Auth::user() : null;
            $user = $user instanceof User ? $user : null;
            $token = $user?->currentAccessToken();

            $message = RecordClientErrorsAction::truncate(class_basename($e).': '.$this->messageOf($e), RecordClientErrorsAction::MAX_MESSAGE);
            $topFrame = $this->relative($e->getFile()).':'.$e->getLine();

            $this->record->execute(
                ulid: strtoupper((string) Str::ulid()),
                source: ErrorGroup::SOURCE_SERVER,
                level: 'error',
                message: $message,
                stack: RecordClientErrorsAction::truncate($this->stackOf($e), RecordClientErrorsAction::MAX_STACK),
                topFrame: $topFrame,
                occurredAt: CarbonImmutable::now(),
                context: ['extra' => array_filter([
                    'route' => $request->route()?->getName(),
                    'method' => $request->method(),
                    'status' => (string) $status,
                ], fn ($value) => is_string($value) && $value !== '')],
                branchId: $user !== null ? (int) $user->branch_id : null,
                userId: $user?->id,
                deviceId: $token instanceof PersonalAccessToken ? $token->device_id : null,
            );
        } catch (Throwable) {
            // Recording never changes the response.
        }
    }

    /**
     * The exception's message, without anything taken from the request: a query error keeps
     * only its SQLSTATE and the SQL with placeholders (the bound values may be input).
     */
    private function messageOf(Throwable $e): string
    {
        if ($e instanceof QueryException) {
            return 'SQLSTATE['.$e->getCode().'] (SQL: '.$e->getSql().')';
        }

        return $e->getMessage();
    }

    /**
     * `Class: message`, then `at file:line` and up to 40 frames `#n file(line): Class->function()`
     * (no arguments), then the same for each previous exception.
     */
    private function stackOf(Throwable $e): string
    {
        $lines = [];

        for ($current = $e, $depth = 0; $current !== null && $depth < 3; $current = $current->getPrevious(), $depth++) {
            if ($depth > 0) {
                $lines[] = 'Caused by '.get_class($current);
            } else {
                $lines[] = get_class($current).': '.$this->messageOf($current);
            }

            $lines[] = 'at '.$this->relative($current->getFile()).':'.$current->getLine();

            foreach (array_slice($current->getTrace(), 0, self::MAX_FRAMES) as $i => $frame) {
                $where = isset($frame['file']) ? $this->relative((string) $frame['file']).'('.($frame['line'] ?? '?').')' : '[internal]';
                $call = ($frame['class'] ?? '').($frame['type'] ?? '').($frame['function'] ?? '').'()';
                $lines[] = "#{$i} {$where}: {$call}";
            }
        }

        return implode("\n", $lines);
    }

    private function relative(string $path): string
    {
        $base = base_path().DIRECTORY_SEPARATOR;

        return str_replace(DIRECTORY_SEPARATOR, '/', str_starts_with($path, $base) ? substr($path, strlen($base)) : $path);
    }
}
