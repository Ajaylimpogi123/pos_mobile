<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Customers\CreateCustomerAction;
use App\Actions\Customers\DeleteCustomerAction;
use App\Actions\Customers\UpdateCustomerAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Customers\ListCustomersRequest;
use App\Http\Requests\Customers\StoreCustomerRequest;
use App\Http\Requests\Customers\UpdateCustomerRequest;
use App\Http\Resources\CustomerResource;
use App\Models\Customer;
use App\Models\User;
use App\Support\SearchPattern;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * Customers: global master data (not branch-scoped). Anyone logged in may look them up,
 * `sale.create` may add and edit, `customer.manage` may delete (CustomerPolicy).
 */
class CustomerController extends Controller
{
    /**
     * GET /api/v1/customers
     *
     * Non-deleted customers ordered by first_name, last_name, id, cursor-paginated.
     * `last_name_sort` is the generated NULL-safe copy of last_name (a NULL cursor
     * value cannot be compared).
     */
    public function index(ListCustomersRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Customer::class);

        $search = $request->search();

        $customers = Customer::query()
            ->when($search !== null, fn (Builder $query) => $this->applySearch($query, $search))
            ->orderBy('first_name')
            ->orderBy('last_name_sort')
            ->orderBy('id')
            ->cursorPaginate($request->perPage())
            ->withQueryString();

        return CustomerResource::collection($customers);
    }

    /**
     * POST /api/v1/customers
     */
    public function store(StoreCustomerRequest $request, CreateCustomerAction $create): JsonResponse
    {
        $this->authorize('create', Customer::class);

        $customer = $create->execute($request->validated(), $this->actor($request), $request->ip());

        return (new CustomerResource($customer))
            ->response()
            ->setStatusCode(201);
    }

    /**
     * GET /api/v1/customers/{customer}
     */
    public function show(Customer $customer): CustomerResource
    {
        $this->authorize('view', $customer);

        return new CustomerResource($customer);
    }

    /**
     * PATCH /api/v1/customers/{customer}
     */
    public function update(UpdateCustomerRequest $request, Customer $customer, UpdateCustomerAction $update): CustomerResource
    {
        $this->authorize('update', $customer);

        return new CustomerResource(
            $update->execute($customer, $request->validated(), $this->actor($request), $request->ip()),
        );
    }

    /**
     * DELETE /api/v1/customers/{customer}
     */
    public function destroy(Request $request, Customer $customer, DeleteCustomerAction $delete): Response
    {
        $this->authorize('delete', $customer);

        $delete->execute($customer, $this->actor($request), $request->ip());

        return response()->noContent();
    }

    /**
     * A search term "looks like a phone number" (contract revision 2) when the whole
     * trimmed term is made of digits, spaces and `+ ( ) -`, with at least this many digits.
     */
    public const PHONE_SEARCH_MIN_DIGITS = 3;

    /**
     * Case-insensitive "contains" on first name, last name, the full name and email.
     *
     * Contact is compared as digits only on both sides (so `09171234567` finds
     * `0917 123 4567`), and only when the whole term looks like a phone number:
     * it matches `^[0-9+()\-\s]+$` and has at least 3 digits. So `juan88` searches
     * names and email only, and `12` never matches a phone.
     *
     * @param  Builder<Customer>  $query
     */
    private function applySearch(Builder $query, string $search): void
    {
        $term = SearchPattern::contains($search);
        $digits = $this->phoneDigits($search);

        $query->where(function (Builder $q) use ($term, $digits) {
            $q->where('first_name', 'like', $term)
                ->orWhere('last_name', 'like', $term)
                ->orWhereRaw("CONCAT_WS(' ', first_name, last_name) LIKE ?", [$term])
                ->orWhere('email', 'like', $term);

            if ($digits !== null) {
                $q->orWhereRaw("REGEXP_REPLACE(contact, '[^0-9]', '') LIKE ?", ['%'.$digits.'%']);
            }
        });
    }

    /**
     * The digits of a phone-like search term, or null when the term is not phone-like.
     */
    private function phoneDigits(string $search): ?string
    {
        $search = trim($search);

        if (preg_match('/^[0-9+()\-\s]+$/', $search) !== 1) {
            return null;
        }

        $digits = preg_replace('/\D+/', '', $search) ?? '';

        return strlen($digits) >= self::PHONE_SEARCH_MIN_DIGITS ? $digits : null;
    }

    private function actor(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
