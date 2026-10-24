<?php

use App\Actions\Errors\RecordServerErrorAction;
use App\Http\Middleware\EnsureIdempotentRequest;
use App\Http\Middleware\EnsurePrintAgentToken;
use App\Http\Middleware\EnsureSessionIsActive;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            'session.active' => EnsureSessionIsActive::class,
            'idempotent' => EnsureIdempotentRequest::class,
            'print.agent' => EnsurePrintAgentToken::class,
        ]);

        // Check the session right after authentication and before route model binding,
        // so a deactivated user gets 401 (not 404) even for an unknown id.
        $middleware->prependToPriorityList(SubstituteBindings::class, EnsureSessionIsActive::class);

        // The idempotency replay check runs after the session check and before route model
        // binding and validation, so a replay returns the stored response unchanged.
        $middleware->prependToPriorityList(SubstituteBindings::class, EnsureIdempotentRequest::class);

        // There is no web login page. API guests get a JSON 401 (never a redirect),
        // even when the client omits the Accept header.
        $middleware->redirectGuestsTo(fn (Request $request) => $request->is('api/*') ? null : '/');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Contract bodies for api/*. These never include debug details or model class names.
        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Resource not found.'], 404);
            }
        });

        $exceptions->render(function (AccessDeniedHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json([
                    'message' => $e->getMessage() !== '' ? $e->getMessage() : 'This action is unauthorized.',
                ], 403);
            }
        });

        $exceptions->render(function (ThrottleRequestsException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Too Many Attempts.'], 429, $e->getHeaders());
            }
        });

        // Any 500 on api/* gets the contract body, in every environment. The exception is
        // still reported to the log; the response never carries its message or trace.
        // Hardening & Pilot → B: every unhandled exception that yields a 5xx is recorded in the
        // error log (source `server`), without request input, headers or the query string.
        // Recording fails silently and never changes the response.
        $exceptions->respond(function (Response $response, Throwable $e, Request $request) {
            if ($response->getStatusCode() >= 500) {
                try {
                    app(RecordServerErrorAction::class)->execute($e, $request, $response->getStatusCode());
                } catch (Throwable) {
                    // Never changes the response.
                }
            }

            if ($request->is('api/*') && $response->getStatusCode() === 500) {
                return response()->json(['message' => 'Server Error.'], 500);
            }

            return $response;
        });
    })->create();
