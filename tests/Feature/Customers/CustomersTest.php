<?php

use App\Models\Customer;
use App\Models\User;

beforeEach(function () {
    seedRoles();
    mainBranch();

    $this->cashier = userWithRole('cashier');
    $this->manager = userWithRole('manager');
    $this->cashierToken = tokenFor($this->cashier);

    // A role with no permissions at all: may still look customers up.
    $this->nobody = User::factory()->forBranch($this->cashier->branch)->create();
});

/**
 * The ids returned by a customer search.
 *
 * @return list<int>
 */
function customerSearch(string $token, string $search): array
{
    return collect(
        test()->withToken($token)->getJson('/api/v1/customers?search='.urlencode($search))->assertOk()->json('data')
    )->pluck('id')->all();
}

describe('index', function () {
    it('lists customers in the exact shape and cursor envelope', function () {
        $maria = Customer::factory()->create([
            'first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => '0917 123 4567',
            'email' => 'maria@example.com', 'notes' => 'Prefers less rice',
        ]);

        $response = $this->withToken($this->cashierToken)->getJson('/api/v1/customers')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and(array_keys($response->json('data.0')))->toBe(customerKeys());

        $response->assertJsonPath('meta.per_page', 25)
            ->assertJsonPath('meta.path', url('/api/v1/customers'))
            ->assertJsonPath('data.0', [
                'id' => $maria->id,
                'first_name' => 'Maria',
                'last_name' => 'Santos',
                'full_name' => 'Maria Santos',
                'contact' => '0917 123 4567',
                'email' => 'maria@example.com',
                'notes' => 'Prefers less rice',
                'created_at' => $maria->created_at->toIso8601ZuluString(),
                'updated_at' => $maria->updated_at->toIso8601ZuluString(),
            ]);
    });

    it('is open to any authenticated user, even one without permissions', function () {
        Customer::factory()->create();

        $this->withToken(tokenFor($this->nobody))->getJson('/api/v1/customers')->assertOk()->assertJsonCount(1, 'data');
    });

    it('excludes soft-deleted customers', function () {
        $kept = Customer::factory()->create();
        Customer::factory()->create()->delete();

        $response = $this->withToken($this->cashierToken)->getJson('/api/v1/customers')->assertOk();

        expect(collect($response->json('data'))->pluck('id')->all())->toBe([$kept->id]);
    });

    it('orders by first_name, last_name, id and paginates across null last names', function () {
        $anaNull2 = Customer::factory()->create(['first_name' => 'Ana', 'last_name' => null]);
        $bea = Customer::factory()->create(['first_name' => 'Bea', 'last_name' => 'Cruz']);
        $anaReyes = Customer::factory()->create(['first_name' => 'Ana', 'last_name' => 'Reyes']);
        $anaNull1Later = Customer::factory()->create(['first_name' => 'Ana', 'last_name' => null]);
        $anaBautista = Customer::factory()->create(['first_name' => 'Ana', 'last_name' => 'Bautista']);

        $expected = [$anaNull2->id, $anaNull1Later->id, $anaBautista->id, $anaReyes->id, $bea->id];

        $all = collect($this->withToken($this->cashierToken)->getJson('/api/v1/customers')->assertOk()->json('data'))->pluck('id')->all();
        expect($all)->toBe($expected);

        // One per page, so the cursor lands on a NULL last name.
        $seen = [];
        $cursor = null;
        do {
            $page = $this->withToken($this->cashierToken)
                ->getJson('/api/v1/customers?per_page=1'.($cursor ? '&cursor='.$cursor : ''))
                ->assertOk();
            $seen = [...$seen, ...collect($page->json('data'))->pluck('id')->all()];
            $cursor = $page->json('meta.next_cursor');
        } while ($cursor !== null && count($seen) < 10);

        expect($seen)->toBe($expected);
    });

    it('searches first, last and full name, and email, case-insensitively', function () {
        $maria = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => null]);
        $juan = Customer::factory()->create([
            'first_name' => 'Juan', 'last_name' => 'Dela Cruz', 'contact' => null, 'email' => 'jdc@example.com',
        ]);
        $ana = Customer::factory()->create(['first_name' => 'Ana', 'last_name' => null, 'contact' => null, 'email' => '50%off@example.com']);

        $t = $this->cashierToken;

        expect(customerSearch($t, 'mar'))->toBe([$maria->id])
            ->and(customerSearch($t, 'SANTOS'))->toBe([$maria->id])
            ->and(customerSearch($t, 'maria santos'))->toBe([$maria->id])
            ->and(customerSearch($t, 'Juan Dela'))->toBe([$juan->id])
            ->and(customerSearch($t, 'JDC@EXAMPLE'))->toBe([$juan->id])
            ->and(customerSearch($t, 'ana'))->toBe([$ana->id])
            ->and(customerSearch($t, '%'))->toBe([$ana->id])
            ->and(customerSearch($t, '_'))->toBe([])
            ->and(customerSearch($t, 'nobody'))->toBe([]);
    });

    it('matches contact as digits only on both sides', function () {
        $maria = Customer::factory()->create(['first_name' => 'Maria', 'contact' => '0917 123 4567']);
        $juan = Customer::factory()->create(['first_name' => 'Juan', 'contact' => '+63 (918) 765-4321']);
        Customer::factory()->create(['first_name' => 'Ana', 'contact' => null]);

        $t = $this->cashierToken;

        expect(customerSearch($t, '09171234567'))->toBe([$maria->id])
            ->and(customerSearch($t, '0917-123-4567'))->toBe([$maria->id])
            ->and(customerSearch($t, '123 4567'))->toBe([$maria->id])
            ->and(customerSearch($t, '639187654321'))->toBe([$juan->id])
            ->and(customerSearch($t, '(918) 765'))->toBe([$juan->id])
            ->and(customerSearch($t, '0000'))->toBe([]);
    });

    it('does not apply the contact clause to a term without digits', function () {
        // Every contact would match an empty digit string; a term with no digits must not.
        Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => '0917 123 4567']);

        expect(customerSearch($this->cashierToken, '+ ( ) -'))->toBe([]);
    });

    describe('revision 2: the contact clause only applies to phone-like terms', function () {
        beforeEach(function () {
            $this->maria = Customer::factory()->create([
                'first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => '0917 123 4567', 'email' => null,
            ]);
            // Digits 8 and 12 appear in this phone, never in a name or email.
            $this->pedro = Customer::factory()->create([
                'first_name' => 'Pedro', 'last_name' => 'Penduko', 'contact' => '0918 812 8800', 'email' => null,
            ]);
            $this->juan = Customer::factory()->create([
                'first_name' => 'Juan', 'last_name' => 'Dela Cruz', 'contact' => null, 'email' => 'juan88@example.com',
            ]);
        });

        it('does not match a phone for a term mixing letters and digits', function () {
            // `juan88` finds Juan by email, never Pedro by the 88 in his phone.
            expect(customerSearch($this->cashierToken, 'juan88'))->toBe([$this->juan->id])
                ->and(customerSearch($this->cashierToken, 'pedro 0918'))->toBe([]);
        });

        it('matches a phone for a partial or full digit term', function () {
            expect(customerSearch($this->cashierToken, '0917'))->toBe([$this->maria->id])
                ->and(customerSearch($this->cashierToken, '09171234567'))->toBe([$this->maria->id])
                ->and(customerSearch($this->cashierToken, '  0917  '))->toBe([$this->maria->id]);
        });

        it('matches a phone typed with brackets, spaces and dashes', function () {
            expect(customerSearch($this->cashierToken, '(0917) 123-4567'))->toBe([$this->maria->id])
                ->and(customerSearch($this->cashierToken, '+0918-812'))->toBe([$this->pedro->id]);
        });

        it('does not use the phone clause for fewer than 3 digits', function () {
            // `12` is in both phones, `88` in Pedro's, but two digits are not phone-like.
            expect(customerSearch($this->cashierToken, '12'))->toBe([])
                ->and(customerSearch($this->cashierToken, '(8-8)'))->toBe([])
                ->and(customerSearch($this->cashierToken, '812'))->toBe([$this->pedro->id]);
        });
    });

    it('validates per_page and search', function () {
        $this->withToken($this->cashierToken)->getJson('/api/v1/customers?per_page=101')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);

        $this->withToken($this->cashierToken)->getJson('/api/v1/customers?search='.str_repeat('a', 101))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['search' => 'The search field must not be greater than 100 characters.']);
    });

    it('returns 401 without a token', function () {
        $this->getJson('/api/v1/customers')->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
    });
});

describe('store', function () {
    it('lets a cashier create a customer (201) and audits it', function () {
        $response = $this->withToken($this->cashierToken)
            ->postJson('/api/v1/customers', [
                'first_name' => '  Maria ',
                'last_name' => 'Santos',
                'contact' => '0917 123 4567',
                'email' => ' Maria@Example.COM ',
                'notes' => 'Prefers less rice',
            ])
            ->assertCreated();

        $customer = Customer::query()->firstOrFail();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(customerKeys());

        $response->assertJsonPath('data.id', $customer->id)
            ->assertJsonPath('data.first_name', 'Maria')
            ->assertJsonPath('data.full_name', 'Maria Santos')
            ->assertJsonPath('data.email', 'maria@example.com')
            ->assertJsonPath('data.contact', '0917 123 4567')
            ->assertJsonPath('data.created_at', $customer->created_at->toIso8601ZuluString());

        expect($customer->email)->toBe('maria@example.com')
            ->and($customer->created_by)->toBe($this->cashier->id)
            ->and($customer->updated_by)->toBe($this->cashier->id);

        $audit = lastAudit('customer.created');
        expect($audit->actor_id)->toBe($this->cashier->id)
            ->and($audit->subject_id)->toBe($customer->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'first_name' => ['from' => null, 'to' => 'Maria'],
                'last_name' => ['from' => null, 'to' => 'Santos'],
                'contact' => ['from' => null, 'to' => '0917 123 4567'],
                'email' => ['from' => null, 'to' => 'maria@example.com'],
                'notes' => ['from' => null, 'to' => 'Prefers less rice'],
            ]));
    });

    it('creates with only a first name; nullable fields come back as null', function () {
        $this->withToken($this->cashierToken)
            ->postJson('/api/v1/customers', ['first_name' => 'Ana'])
            ->assertCreated()
            ->assertJsonPath('data.first_name', 'Ana')
            ->assertJsonPath('data.last_name', null)
            ->assertJsonPath('data.full_name', 'Ana')
            ->assertJsonPath('data.contact', null)
            ->assertJsonPath('data.email', null)
            ->assertJsonPath('data.notes', null);
    });

    it('does not require a unique email', function () {
        Customer::factory()->create(['email' => 'family@example.com']);

        $this->withToken($this->cashierToken)
            ->postJson('/api/v1/customers', ['first_name' => 'Juan', 'email' => 'family@example.com'])
            ->assertCreated();
    });

    it('forbids a user without sale.create', function () {
        $this->withToken(tokenFor($this->nobody))
            ->postJson('/api/v1/customers', ['first_name' => 'Ana'])
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);
    });

    it('returns 401 without a token', function () {
        $this->postJson('/api/v1/customers', ['first_name' => 'Ana'])->assertUnauthorized();
    });

    describe('validation (422)', function () {
        it('requires first_name', function () {
            $this->withToken($this->cashierToken)
                ->postJson('/api/v1/customers', ['first_name' => '   '])
                ->assertUnprocessable()
                ->assertJsonValidationErrors(['first_name' => 'The first name field is required.']);
        });

        it('enforces max lengths and email format', function () {
            $this->withToken($this->cashierToken)
                ->postJson('/api/v1/customers', [
                    'first_name' => str_repeat('a', 61),
                    'last_name' => str_repeat('a', 61),
                    'contact' => str_repeat('1', 31),
                    'email' => 'not-an-email',
                    'notes' => str_repeat('a', 501),
                ])
                ->assertUnprocessable()
                ->assertJsonValidationErrors([
                    'first_name' => 'The first name field must not be greater than 60 characters.',
                    'last_name' => 'The last name field must not be greater than 60 characters.',
                    'contact' => 'The contact field must not be greater than 30 characters.',
                    'email' => 'The email field must be a valid email address.',
                    'notes' => 'The notes field must not be greater than 500 characters.',
                ]);
        });

        it('only allows digits, spaces and + ( ) - in contact', function (string $contact, bool $valid) {
            $response = $this->withToken($this->cashierToken)
                ->postJson('/api/v1/customers', ['first_name' => 'Ana', 'contact' => $contact]);

            $valid
                ? $response->assertCreated()
                : $response->assertUnprocessable()->assertJsonValidationErrors(['contact' => 'The contact field format is invalid.']);
        })->with([
            ['0917 123 4567', true],
            ['+63 (917) 123-4567', true],
            ['0917.123.4567', false],
            ['call me', false],
            ['0917#1234', false],
        ]);
    });
});

describe('show', function () {
    it('returns the customer to any authenticated user', function () {
        $customer = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);

        $response = $this->withToken(tokenFor($this->nobody))
            ->getJson("/api/v1/customers/{$customer->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $customer->id)
            ->assertJsonPath('data.full_name', 'Maria Santos');

        expect(array_keys($response->json('data')))->toBe(customerKeys());
    });

    it('returns 404 for a missing or soft-deleted customer, and 401 without a token', function () {
        $deleted = Customer::factory()->create();
        $deleted->delete();

        $this->withToken($this->cashierToken)->getJson('/api/v1/customers/999999')
            ->assertNotFound()->assertExactJson(['message' => 'Resource not found.']);
        $this->withToken($this->cashierToken)->getJson("/api/v1/customers/{$deleted->id}")->assertNotFound();
        $this->withoutToken()->getJson("/api/v1/customers/{$deleted->id}")->assertUnauthorized();
    });
});

describe('update', function () {
    it('applies a partial update, clears with null, and audits only the changes', function () {
        $customer = Customer::factory()->create([
            'first_name' => 'Maria', 'last_name' => 'Santos', 'contact' => '0917 123 4567', 'email' => null, 'notes' => 'Old',
        ]);

        $this->withToken($this->cashierToken)
            ->patchJson("/api/v1/customers/{$customer->id}", ['last_name' => null, 'email' => 'MARIA@example.com'])
            ->assertOk()
            ->assertJsonPath('data.first_name', 'Maria')
            ->assertJsonPath('data.last_name', null)
            ->assertJsonPath('data.full_name', 'Maria')
            ->assertJsonPath('data.email', 'maria@example.com')
            ->assertJsonPath('data.contact', '0917 123 4567')
            ->assertJsonPath('data.notes', 'Old');

        expect(ksortDeep(lastAudit('customer.updated')->changes))->toBe(ksortDeep([
            'last_name' => ['from' => 'Santos', 'to' => null],
            'email' => ['from' => null, 'to' => 'maria@example.com'],
        ]))
            ->and($customer->fresh()->updated_by)->toBe($this->cashier->id);
    });

    it('writes nothing when nothing changes', function () {
        $customer = Customer::factory()->create(['first_name' => 'Maria']);

        $this->withToken($this->cashierToken)
            ->patchJson("/api/v1/customers/{$customer->id}", ['first_name' => 'Maria'])
            ->assertOk();

        expect(lastAudit('customer.updated'))->toBeNull();
    });

    it('rejects a null first_name and an invalid contact', function () {
        $customer = Customer::factory()->create();

        $this->withToken($this->cashierToken)
            ->patchJson("/api/v1/customers/{$customer->id}", ['first_name' => null, 'contact' => 'abc'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'first_name' => 'The first name field is required.',
                'contact' => 'The contact field format is invalid.',
            ]);
    });

    it('forbids a user without sale.create, 404s a missing customer, 401 without a token', function () {
        $customer = Customer::factory()->create();

        $this->withToken(tokenFor($this->nobody))
            ->patchJson("/api/v1/customers/{$customer->id}", ['first_name' => 'X'])
            ->assertForbidden();

        $this->withToken($this->cashierToken)
            ->patchJson('/api/v1/customers/999999', ['first_name' => 'X'])
            ->assertNotFound();

        $this->withoutToken()->patchJson("/api/v1/customers/{$customer->id}", ['first_name' => 'X'])->assertUnauthorized();
    });
});

describe('destroy', function () {
    it('forbids a cashier (no customer.manage)', function () {
        $customer = Customer::factory()->create();

        $this->withToken($this->cashierToken)
            ->deleteJson("/api/v1/customers/{$customer->id}")
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        expect($customer->fresh()->trashed())->toBeFalse();
    });

    it('lets a manager soft-delete a customer, then 404s it', function () {
        $customer = Customer::factory()->create(['first_name' => 'Maria', 'last_name' => 'Santos']);
        $token = tokenFor($this->manager);

        $this->withToken($token)->deleteJson("/api/v1/customers/{$customer->id}")->assertNoContent();

        expect(Customer::withTrashed()->find($customer->id)->trashed())->toBeTrue()
            ->and(lastAudit('customer.deleted')->changes)->toBe(['full_name' => 'Maria Santos'])
            ->and(lastAudit('customer.deleted')->actor_id)->toBe($this->manager->id);

        $this->withToken($token)->getJson("/api/v1/customers/{$customer->id}")->assertNotFound();
        $this->withToken($token)->deleteJson("/api/v1/customers/{$customer->id}")->assertNotFound();
    });

    it('lets an owner delete, and returns 401 without a token', function () {
        $customer = Customer::factory()->create();

        $this->withoutToken()->deleteJson("/api/v1/customers/{$customer->id}")->assertUnauthorized();

        $this->withToken(tokenFor(userWithRole('owner')))
            ->deleteJson("/api/v1/customers/{$customer->id}")
            ->assertNoContent();
    });
});
