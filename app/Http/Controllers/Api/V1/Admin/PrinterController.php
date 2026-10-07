<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Actions\Printing\CreatePrinterAction;
use App\Actions\Printing\DeletePrinterAction;
use App\Actions\Printing\UpdatePrinterAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\Printing\ListPrintersRequest;
use App\Http\Requests\Admin\Printing\StorePrinterRequest;
use App\Http\Requests\Admin\Printing\UpdatePrinterRequest;
use App\Http\Resources\PrinterResource;
use App\Models\Printer;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Admin management of the caller's branch printers (permission `settings.manage`).
 * `{printer}` resolves only within the caller's branch (see AppServiceProvider), so a
 * printer of another branch, or a deleted one, is a 404 on every endpoint.
 */
class PrinterController extends Controller
{
    /**
     * GET /api/v1/admin/printers
     *
     * Non-deleted printers of the caller's branch (disabled included), ordered by name
     * then id, cursor-paginated (default 100).
     */
    public function index(ListPrintersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Printer::class);

        $printers = Printer::query()
            ->with('categories')
            ->where('branch_id', $this->actor($request)->branch_id)
            ->orderBy('name')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return PrinterResource::collection($printers);
    }

    /**
     * POST /api/v1/admin/printers
     */
    public function store(StorePrinterRequest $request, CreatePrinterAction $create): JsonResponse
    {
        $this->authorize('create', Printer::class);

        $printer = $create->execute($request->validated(), $this->actor($request), $request->ip());

        return (new PrinterResource($printer))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/admin/printers/{printer}
     */
    public function show(Printer $printer): PrinterResource
    {
        $this->authorize('view', $printer);

        return new PrinterResource($printer->load('categories'));
    }

    /**
     * PATCH /api/v1/admin/printers/{printer}
     */
    public function update(UpdatePrinterRequest $request, Printer $printer, UpdatePrinterAction $update): PrinterResource
    {
        $this->authorize('update', $printer);

        return new PrinterResource($update->execute($printer, $request->validated(), $this->actor($request), $request->ip()));
    }

    /**
     * DELETE /api/v1/admin/printers/{printer}
     */
    public function destroy(Request $request, Printer $printer, DeletePrinterAction $delete): Response
    {
        $this->authorize('delete', $printer);

        $delete->execute($printer, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
