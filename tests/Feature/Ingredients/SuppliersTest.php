<?php

use App\Models\Supplier;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->cashier = userWithRole('cashier');
});

describe('create, read, update', function () {
    it('creates a supplier (201) with the audit entry', function () {
        $response = $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/suppliers', [
            'name' => 'Metro Supply', 'contact_person' => 'Ana', 'contact_number' => '09171234567',
            'email' => 'orders@metro.test', 'address' => 'Bacolod',
        ])->assertCreated();

        expect(array_keys($response->json('data')))->toBe(supplierKeys())
            ->and($response->json('data'))->toMatchArray([
                'name' => 'Metro Supply', 'contact_person' => 'Ana', 'contact_number' => '09171234567',
                'email' => 'orders@metro.test', 'address' => 'Bacolod', 'is_active' => true,
            ])
            ->and(ksortDeep(lastAudit('supplier.created')->changes['name']))->toBe(['from' => null, 'to' => 'Metro Supply']);
    });

    it('updates partially and audits only the changes', function () {
        $supplier = makeSupplier('Metro Supply');

        $this->withToken(tokenFor($this->manager))->patchJson("/api/v1/admin/suppliers/{$supplier->id}", ['is_active' => false, 'address' => null])
            ->assertOk()
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.name', 'Metro Supply');

        expect(ksortDeep(lastAudit('supplier.updated')->changes))->toBe(['is_active' => ['from' => true, 'to' => false]]);
    });

    it('validates the fields', function () {
        makeSupplier('Metro Supply');

        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/suppliers', [
            'name' => 'metro supply', 'contact_number' => str_repeat('9', 31), 'email' => 'nope',
        ])->assertUnprocessable()->assertJsonValidationErrors(['name', 'contact_number', 'email']);

        $this->withToken(tokenFor($this->manager))->postJson('/api/v1/admin/suppliers', [])
            ->assertUnprocessable()->assertJsonValidationErrors(['name']);
    });

    it('lists with cursor pagination, search and is_active', function () {
        makeSupplier('Metro Supply', ['contact_person' => 'Ana']);
        makeSupplier('Bacolod Farms', ['is_active' => false]);
        makeSupplier('Zeta Eggs');

        $token = tokenFor($this->manager);

        $page = $this->withToken($token)->getJson('/api/v1/admin/suppliers?per_page=2')->assertOk();
        expect(collect($page->json('data'))->pluck('name')->all())->toBe(['Bacolod Farms', 'Metro Supply'])
            ->and($page->json('meta.next_cursor'))->toBeString()
            ->and($page->json('meta.per_page'))->toBe(2);

        expect(collect($this->withToken($token)->getJson('/api/v1/admin/suppliers?search=ana')->json('data'))->pluck('name')->all())->toBe(['Metro Supply'])
            ->and(collect($this->withToken($token)->getJson('/api/v1/admin/suppliers?is_active=false')->json('data'))->pluck('name')->all())->toBe(['Bacolod Farms']);

        $this->withToken($token)->getJson('/api/v1/admin/suppliers?per_page=101')->assertUnprocessable();
    });
});

describe('delete', function () {
    it('soft-deletes an unused supplier (204, then 404)', function () {
        $supplier = makeSupplier();

        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/admin/suppliers/{$supplier->id}")->assertNoContent();

        expect(Supplier::withTrashed()->find($supplier->id)->trashed())->toBeTrue();
        $this->withToken(tokenFor($this->manager))->getJson("/api/v1/admin/suppliers/{$supplier->id}")->assertNotFound()
            ->assertExactJson(['message' => 'Resource not found.']);
    });

    it('refuses a supplier used on a purchase request (409)', function () {
        $supplier = makeSupplier();
        createPurchaseRequest($this->manager, [prItem(makeIngredient('Flour'), $supplier, '1', 'kg')]);

        $this->withToken(tokenFor($this->manager))->deleteJson("/api/v1/admin/suppliers/{$supplier->id}")
            ->assertConflict()
            ->assertExactJson(['message' => 'This supplier is on purchase orders. Deactivate it instead.']);
    });
});

describe('permissions', function () {
    it('needs a token', function () {
        $this->getJson('/api/v1/admin/suppliers')->assertUnauthorized();
        $this->postJson('/api/v1/admin/suppliers', [])->assertUnauthorized();
    });

    it('refuses a cashier (403)', function () {
        $supplier = makeSupplier();
        $token = tokenFor($this->cashier);

        $this->withToken($token)->getJson('/api/v1/admin/suppliers')->assertForbidden();
        $this->withToken($token)->postJson('/api/v1/admin/suppliers', ['name' => 'X'])->assertForbidden();
        $this->withToken($token)->patchJson("/api/v1/admin/suppliers/{$supplier->id}", ['name' => 'X'])->assertForbidden();
        $this->withToken($token)->deleteJson("/api/v1/admin/suppliers/{$supplier->id}")->assertForbidden();
    });

    it('lets any purchase permission read, but only supplier.manage write', function () {
        $supplier = makeSupplier();
        $receiver = User::factory()->forBranch($this->branch)->create(['role_id' => customRole('receiver', ['purchase.receive'])->id]);
        $token = tokenFor($receiver);

        $this->withToken($token)->getJson('/api/v1/admin/suppliers')->assertOk();
        $this->withToken($token)->getJson("/api/v1/admin/suppliers/{$supplier->id}")->assertOk();
        $this->withToken($token)->postJson('/api/v1/admin/suppliers', ['name' => 'X'])->assertForbidden();
    });

    it('returns 404 for an unknown supplier', function () {
        $this->withToken(tokenFor($this->manager))->getJson('/api/v1/admin/suppliers/999999')->assertNotFound();
    });
});
