<?php

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\Category;
use App\Models\Printer;
use App\Models\PrintRoute;
use Carbon\Carbon;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->otherBranch = Branch::factory()->create(['code' => 'NORTH']);

    Carbon::setTestNow('2026-09-25 02:00:00');

    $this->manager = userWithRole('manager', ['name' => 'Marco Manager']);
    $this->token = tokenFor($this->manager);

    $this->breakfast = Category::factory()->create(['name' => 'Breakfast']);
    $this->meals = Category::factory()->create(['name' => 'Meals']);
    $this->drinks = Category::factory()->create(['name' => 'Drinks']);
});

afterEach(function () {
    Carbon::setTestNow();
});

/**
 * A valid store body (a kitchen printer) with overrides.
 *
 * @return array<string, mixed>
 */
function printerBody(array $overrides = []): array
{
    return array_replace(['name' => 'Kitchen', 'role' => 'kitchen', 'host' => '192.168.1.60'], $overrides);
}

function storePrinter(array $body, ?string $token = null): TestResponse
{
    return test()->withToken($token ?? test()->token)->postJson('/api/v1/admin/printers', $body);
}

function patchPrinter(Printer|int $printer, array $body, ?string $token = null): TestResponse
{
    $id = $printer instanceof Printer ? $printer->id : $printer;

    return test()->withToken($token ?? test()->token)->patchJson("/api/v1/admin/printers/{$id}", $body);
}

function printerIn(Branch $branch, array $attributes = []): Printer
{
    return Printer::factory()->forBranch($branch)->create($attributes);
}

/**
 * Route categories to a printer directly (no side effects).
 *
 * @param  list<Category>  $categories
 */
function routeTo(Printer $printer, array $categories): void
{
    foreach ($categories as $category) {
        PrintRoute::query()->insert([
            'branch_id' => $printer->branch_id, 'category_id' => $category->id, 'printer_id' => $printer->id,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}

describe('auth', function () {
    it('returns 401 without a token', function (string $method, string $uri) {
        $printer = printerIn($this->branch);

        $this->json($method, str_replace('{id}', (string) $printer->id, $uri))
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    })->with([
        ['GET', '/api/v1/admin/printers'],
        ['POST', '/api/v1/admin/printers'],
        ['GET', '/api/v1/admin/printers/{id}'],
        ['PATCH', '/api/v1/admin/printers/{id}'],
        ['DELETE', '/api/v1/admin/printers/{id}'],
    ]);

    it('returns 403 for a cashier (no settings.manage) and writes nothing', function (string $method, string $uri, array $body) {
        $printer = printerIn($this->branch, ['name' => 'Kitchen']);
        $cashier = userWithRole('cashier');

        $this->withToken(tokenFor($cashier))
            ->json($method, str_replace('{id}', (string) $printer->id, $uri), $body)
            ->assertForbidden()
            ->assertExactJson(['message' => 'This action is unauthorized.']);

        expect(Printer::query()->count())->toBe(1)
            ->and($printer->fresh()->name)->toBe('Kitchen')
            ->and(AuditLog::query()->where('action', 'like', 'printer.%')->count())->toBe(0);
    })->with([
        ['GET', '/api/v1/admin/printers', []],
        ['POST', '/api/v1/admin/printers', ['name' => 'Bar', 'role' => 'bar', 'host' => '10.0.0.1']],
        ['POST', '/api/v1/admin/printers', []], // 403 before validation
        ['GET', '/api/v1/admin/printers/{id}', []],
        ['PATCH', '/api/v1/admin/printers/{id}', ['name' => 'Renamed']],
        ['DELETE', '/api/v1/admin/printers/{id}', []],
    ]);

    it('allows an owner', function () {
        $owner = userWithRole('owner');

        storePrinter(printerBody(), tokenFor($owner))->assertCreated();
    });
});

describe('index', function () {
    it('lists the branch printers in the exact shape, disabled included, with a default page size of 100', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true, 'host' => '192.168.1.60']);
        routeTo($kitchen, [$this->meals, $this->breakfast]);
        $disabled = printerIn($this->branch, ['name' => 'Bar', 'role' => 'bar', 'is_enabled' => false]);
        printerIn($this->branch, ['name' => 'Deleted'])->delete();
        printerIn($this->otherBranch, ['name' => 'Elsewhere']);

        $response = $this->withToken($this->token)->getJson('/api/v1/admin/printers')->assertOk();

        expect(array_keys($response->json()))->toBe(['data', 'links', 'meta'])
            ->and(array_keys($response->json('meta')))->toBe(['path', 'per_page', 'next_cursor', 'prev_cursor'])
            ->and(array_keys($response->json('data.0')))->toBe(printerKeys())
            ->and(collect($response->json('data'))->pluck('id')->all())->toBe([$disabled->id, $kitchen->id]);

        $response->assertJsonPath('meta.per_page', 100)
            ->assertJsonPath('meta.next_cursor', null)
            ->assertJsonPath('meta.path', url('/api/v1/admin/printers'))
            ->assertJsonPath('data.0.is_enabled', false)
            ->assertJsonPath('data.1', [
                'id' => $kitchen->id,
                'name' => 'Kitchen',
                'role' => 'kitchen',
                'host' => '192.168.1.60',
                'port' => 9100,
                'paper_width_mm' => 80,
                'is_enabled' => true,
                'is_default_kitchen' => true,
                'category_ids' => [$this->breakfast->id, $this->meals->id],
                'created_at' => '2026-09-25T02:00:00Z',
                'updated_at' => '2026-09-25T02:00:00Z',
            ]);
    });

    it('orders by name then id and paginates with a cursor', function () {
        $b1 = printerIn($this->branch, ['name' => 'B']);
        $a = printerIn($this->branch, ['name' => 'A']);
        $c = printerIn($this->branch, ['name' => 'C']);

        $page1 = $this->withToken($this->token)->getJson('/api/v1/admin/printers?per_page=2')->assertOk();
        expect(collect($page1->json('data'))->pluck('id')->all())->toBe([$a->id, $b1->id])
            ->and($page1->json('meta.next_cursor'))->toBeString();

        $page2 = $this->withToken($this->token)
            ->getJson('/api/v1/admin/printers?per_page=2&cursor='.$page1->json('meta.next_cursor'))
            ->assertOk();
        expect(collect($page2->json('data'))->pluck('id')->all())->toBe([$c->id])
            ->and($page2->json('meta.next_cursor'))->toBeNull();
    });

    it('validates query params', function (string $query) {
        $this->withToken($this->token)
            ->getJson('/api/v1/admin/printers?'.$query)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['per_page']);
    })->with(['per_page=0', 'per_page=101', 'per_page=abc']);
});

describe('show', function () {
    it('returns the printer', function () {
        $printer = printerIn($this->branch, ['name' => 'Kitchen']);

        $response = $this->withToken($this->token)->getJson("/api/v1/admin/printers/{$printer->id}")->assertOk();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(printerKeys());
        $response->assertJsonPath('data.id', $printer->id)->assertJsonPath('data.category_ids', []);
    });

    it('returns 404 for another branch, a deleted or an unknown printer', function (string $case) {
        $id = match ($case) {
            'other branch' => printerIn($this->otherBranch)->id,
            'deleted' => tap(printerIn($this->branch))->delete()->id,
            'unknown' => 999999,
        };

        foreach (['GET', 'PATCH', 'DELETE'] as $method) {
            $this->withToken($this->token)
                ->json($method, "/api/v1/admin/printers/{$id}", ['name' => 'X'])
                ->assertNotFound()
                ->assertExactJson(['message' => 'Resource not found.']);
        }
    })->with(['other branch', 'deleted', 'unknown']);

    it('leaves routes to soft-deleted categories out of category_ids', function () {
        $printer = printerIn($this->branch);
        routeTo($printer, [$this->breakfast, $this->meals]);
        $this->meals->delete();

        $this->withToken($this->token)->getJson("/api/v1/admin/printers/{$printer->id}")
            ->assertOk()
            ->assertJsonPath('data.category_ids', [$this->breakfast->id]);
    });
});

describe('store', function () {
    it('creates a printer and returns 201 with the exact Printer', function () {
        $response = storePrinter([
            'name' => 'Bar',
            'role' => 'bar',
            'host' => 'bar-printer.local',
            'port' => 9102,
            'paper_width_mm' => 58,
            'is_enabled' => true,
            'is_default_kitchen' => true,
            'category_ids' => [$this->drinks->id, $this->meals->id],
        ])->assertCreated();

        $printer = Printer::query()->sole();

        expect(array_keys($response->json()))->toBe(['data'])
            ->and(array_keys($response->json('data')))->toBe(printerKeys());

        $response->assertExactJson(['data' => [
            'id' => $printer->id,
            'name' => 'Bar',
            'role' => 'bar',
            'host' => 'bar-printer.local',
            'port' => 9102,
            'paper_width_mm' => 58,
            'is_enabled' => true,
            'is_default_kitchen' => true,
            'category_ids' => [$this->meals->id, $this->drinks->id],
            'created_at' => '2026-09-25T02:00:00Z',
            'updated_at' => '2026-09-25T02:00:00Z',
        ]]);

        expect($printer->branch_id)->toBe($this->branch->id)
            ->and($printer->created_by)->toBe($this->manager->id)
            ->and($printer->updated_by)->toBe($this->manager->id)
            ->and(PrintRoute::query()->where('branch_id', $this->branch->id)->where('printer_id', $printer->id)->count())->toBe(2);
    });

    it('applies the defaults and ignores unknown fields such as branch_id', function () {
        storePrinter(printerBody(['role' => 'cashier', 'name' => 'Counter', 'branch_id' => $this->otherBranch->id, 'connection' => 'bluetooth']))
            ->assertCreated()
            ->assertJsonPath('data.port', 9100)
            ->assertJsonPath('data.paper_width_mm', 80)
            ->assertJsonPath('data.is_enabled', true)
            ->assertJsonPath('data.is_default_kitchen', false)
            ->assertJsonPath('data.category_ids', []);

        expect(Printer::query()->sole()->branch_id)->toBe($this->branch->id);
    });

    it('writes a printer.created audit entry with the fields and category_ids', function () {
        storePrinter(printerBody(['category_ids' => [$this->meals->id, $this->breakfast->id]]))->assertCreated();

        $printer = Printer::query()->sole();
        $audit = lastAudit('printer.created');

        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_type)->toBe($printer->getMorphClass())
            ->and($audit->subject_id)->toBe($printer->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'name' => ['from' => null, 'to' => 'Kitchen'],
                'role' => ['from' => null, 'to' => 'kitchen'],
                'host' => ['from' => null, 'to' => '192.168.1.60'],
                'port' => ['from' => null, 'to' => 9100],
                'paper_width_mm' => ['from' => null, 'to' => 80],
                'is_enabled' => ['from' => null, 'to' => true],
                'is_default_kitchen' => ['from' => null, 'to' => true], // auto-default
                'category_ids' => ['from' => null, 'to' => [$this->breakfast->id, $this->meals->id]],
            ]));
    });

    it('accepts valid hosts, boundary ports and an inactive category', function (array $body) {
        $inactive = Category::factory()->inactive()->create();

        storePrinter(printerBody([...$body, 'category_ids' => [$inactive->id]]))
            ->assertCreated()
            ->assertJsonPath('data.category_ids', [$inactive->id]);
    })->with([
        'ipv4' => [['host' => '10.0.0.5']],
        'hostname' => [['host' => 'kitchen-printer.store.lan']],
        'single label' => [['host' => 'KITCHEN']],
        '253 characters' => [['host' => implode('.', [str_repeat('a', 63), str_repeat('b', 63), str_repeat('c', 63), str_repeat('d', 61)])]],
        'port 1' => [['port' => 1]],
        'port 65535' => [['port' => 65535]],
        'name 40' => [['name' => str_repeat('n', 40)]],
    ]);

    it('requires name, role and host', function () {
        storePrinter([])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'name' => 'The name field is required.',
                'role' => 'The role field is required.',
                'host' => 'The host field is required.',
            ]);
    });

    it('rejects invalid fields', function (array $body, string $field, string $message) {
        storePrinter(printerBody($body))
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);

        expect(Printer::query()->count())->toBe(0)
            ->and(AuditLog::query()->count())->toBe(0);
    })->with([
        'name too long' => [['name' => str_repeat('a', 41)], 'name', 'The name field must not be greater than 40 characters.'],
        'name not string' => [['name' => 12], 'name', 'The name field must be a string.'],
        'name null' => [['name' => null], 'name', 'The name field is required.'],
        'role invalid' => [['role' => 'receipt'], 'role', 'The selected role is invalid.'],
        'host with scheme' => [['host' => 'http://192.168.1.60'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host with port' => [['host' => '192.168.1.60:9100'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host bad ipv4' => [['host' => '192.168.1.300'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host underscore' => [['host' => 'kitchen_printer'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host leading hyphen' => [['host' => '-kitchen'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host space' => [['host' => 'kitchen printer'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host ipv6' => [['host' => '::1'], 'host', 'The host must be an IPv4 address or a hostname, with no scheme or port.'],
        'host too long' => [['host' => str_repeat('a', 254)], 'host', 'The host field must not be greater than 253 characters.'],
        'port 0' => [['port' => 0], 'port', 'The port field must be at least 1.'],
        'port 65536' => [['port' => 65536], 'port', 'The port field must not be greater than 65535.'],
        'port not integer' => [['port' => 'abc'], 'port', 'The port field must be an integer.'],
        'port null' => [['port' => null], 'port', 'The port field is required.'],
        'paper 70' => [['paper_width_mm' => 70], 'paper_width_mm', 'The selected paper width mm is invalid.'],
        'paper null' => [['paper_width_mm' => null], 'paper_width_mm', 'The paper width mm field is required.'],
        'enabled not boolean' => [['is_enabled' => 'yes'], 'is_enabled', 'The is enabled field must be true or false.'],
        'default not boolean' => [['is_default_kitchen' => 'yes'], 'is_default_kitchen', 'The is default kitchen field must be true or false.'],
        'categories not array' => [['category_ids' => 'all'], 'category_ids', 'The category ids field must be an array.'],
        'categories null' => [['category_ids' => null], 'category_ids', 'The category ids field must be an array.'],
        'category not integer' => [['category_ids' => ['x']], 'category_ids.0', 'The category_ids.0 field must be an integer.'],
        'category unknown' => [['category_ids' => [999999]], 'category_ids.0', 'The selected category_ids.0 is invalid.'],
        'cashier default' => [['role' => 'cashier', 'is_default_kitchen' => true], 'is_default_kitchen', 'Only a kitchen or bar printer can be the default kitchen printer.'],
        'cashier categories' => [['role' => 'cashier', 'category_ids' => [1]], 'category_ids', "Receipt printers don't take categories."],
    ]);

    it('rejects duplicate category ids', function () {
        storePrinter(printerBody(['category_ids' => [$this->meals->id, $this->meals->id]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_ids.0', 'category_ids.1']);
    });

    it('rejects a soft-deleted category', function () {
        $this->meals->delete();

        storePrinter(printerBody(['category_ids' => [$this->meals->id]]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_ids.0' => 'The selected category_ids.0 is invalid.']);
    });

    it('accepts a cashier printer with is_default_kitchen false and no categories', function () {
        storePrinter(printerBody(['role' => 'cashier', 'is_default_kitchen' => false, 'category_ids' => []]))
            ->assertCreated()
            ->assertJsonPath('data.is_default_kitchen', false);
    });

    it('requires a unique name per branch among non-deleted printers, case-insensitively', function () {
        printerIn($this->branch, ['name' => 'Kitchen']);

        storePrinter(printerBody(['name' => 'KITCHEN']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name has already been taken.']);
    });

    it('allows the name of a deleted printer or of another branch printer', function () {
        printerIn($this->branch, ['name' => 'Kitchen'])->delete();
        printerIn($this->otherBranch, ['name' => 'Bar']);

        storePrinter(printerBody(['name' => 'Kitchen']))->assertCreated();
        storePrinter(printerBody(['name' => 'Bar', 'role' => 'bar']))->assertCreated();
    });
});

describe('printer limit', function () {
    it('returns 409 when the branch already has 20 printers, and writes nothing', function () {
        Printer::factory()->forBranch($this->branch)->count(20)->create();

        storePrinter(printerBody(['name' => 'One Too Many']))
            ->assertStatus(409)
            ->assertExactJson(['message' => 'A branch can have up to 20 printers.']);

        expect(Printer::query()->where('branch_id', $this->branch->id)->count())->toBe(20)
            ->and(lastAudit('printer.created'))->toBeNull();
    });

    it('does not count deleted printers or other branches', function () {
        Printer::factory()->forBranch($this->branch)->count(19)->create();
        printerIn($this->branch)->delete();
        Printer::factory()->forBranch($this->otherBranch)->count(3)->create();

        storePrinter(printerBody(['name' => 'Twentieth']))->assertCreated();
        storePrinter(printerBody(['name' => 'Twenty-first']))->assertStatus(409);
    });

    it('checks validation before the limit', function () {
        Printer::factory()->forBranch($this->branch)->count(20)->create();

        storePrinter([])->assertUnprocessable();
    });
});

describe('default kitchen printer', function () {
    it('makes the first enabled kitchen or bar printer the default automatically', function (string $role) {
        storePrinter(printerBody(['role' => $role]))->assertCreated()->assertJsonPath('data.is_default_kitchen', true);
    })->with(['kitchen', 'bar']);

    it('applies the auto-default even when is_default_kitchen false is sent (Q-005, provisional)', function () {
        storePrinter(printerBody(['is_default_kitchen' => false]))->assertCreated()->assertJsonPath('data.is_default_kitchen', true);
    });

    it('does not auto-default a disabled or a cashier printer, or when a default exists', function () {
        storePrinter(printerBody(['name' => 'Off', 'is_enabled' => false]))->assertCreated()->assertJsonPath('data.is_default_kitchen', false);
        storePrinter(printerBody(['name' => 'Counter', 'role' => 'cashier']))->assertCreated()->assertJsonPath('data.is_default_kitchen', false);
        storePrinter(printerBody(['name' => 'Kitchen']))->assertCreated()->assertJsonPath('data.is_default_kitchen', true);
        storePrinter(printerBody(['name' => 'Bar', 'role' => 'bar']))->assertCreated()->assertJsonPath('data.is_default_kitchen', false);

        expect(Printer::query()->where('is_default_kitchen', true)->pluck('name')->all())->toBe(['Kitchen']);
    });

    it('counts a disabled default as a default', function () {
        printerIn($this->branch, ['name' => 'Old', 'is_enabled' => false, 'is_default_kitchen' => true]);

        storePrinter(printerBody())->assertCreated()->assertJsonPath('data.is_default_kitchen', false);
    });

    it('ignores another branch default', function () {
        printerIn($this->otherBranch, ['is_default_kitchen' => true]);

        storePrinter(printerBody())->assertCreated()->assertJsonPath('data.is_default_kitchen', true);
    });

    it('clears the flag on every other printer of the branch, audited on each', function () {
        $old = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        $elsewhere = printerIn($this->otherBranch, ['is_default_kitchen' => true]);

        Carbon::setTestNow('2026-09-25 02:05:00');

        $response = storePrinter(printerBody(['name' => 'Bar', 'role' => 'bar', 'is_default_kitchen' => true]))->assertCreated();

        $old->refresh();
        expect($old->is_default_kitchen)->toBeFalse()
            ->and($old->updated_at->toIso8601ZuluString())->toBe('2026-09-25T02:05:00Z')
            ->and($old->updated_by)->toBe($this->manager->id)
            ->and($elsewhere->fresh()->is_default_kitchen)->toBeTrue();

        $audit = AuditLog::query()->where('action', 'printer.updated')->sole();
        expect($audit->subject_id)->toBe($old->id)
            ->and(ksortDeep($audit->changes))->toBe(['is_default_kitchen' => ['from' => true, 'to' => false]]);

        $this->withToken($this->token)->getJson('/api/v1/admin/printers')
            ->assertOk()
            ->assertJsonPath('data.0.id', $response->json('data.id'))
            ->assertJsonPath('data.0.is_default_kitchen', true)
            ->assertJsonPath('data.1.is_default_kitchen', false);
    });

    it('moves the default on update', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        $bar = printerIn($this->branch, ['name' => 'Bar', 'role' => 'bar']);

        patchPrinter($bar, ['is_default_kitchen' => true])->assertOk()->assertJsonPath('data.is_default_kitchen', true);

        expect($kitchen->fresh()->is_default_kitchen)->toBeFalse()
            ->and(AuditLog::query()->where('action', 'printer.updated')->orderBy('id')->get()->map(fn (AuditLog $a) => [$a->subject_id, ksortDeep($a->changes)])->all())
            ->toBe([
                [$bar->id, ['is_default_kitchen' => ['from' => false, 'to' => true]]],
                [$kitchen->id, ['is_default_kitchen' => ['from' => true, 'to' => false]]],
            ]);
    });

    it('makes a kitchen printer the default when it is enabled and the branch has none', function () {
        $printer = printerIn($this->branch, ['is_enabled' => false]);

        patchPrinter($printer, ['is_enabled' => true])
            ->assertOk()
            ->assertJsonPath('data.is_enabled', true)
            ->assertJsonPath('data.is_default_kitchen', true);

        expect(ksortDeep(lastAudit('printer.updated')->changes))->toBe(ksortDeep([
            'is_enabled' => ['from' => false, 'to' => true],
            'is_default_kitchen' => ['from' => false, 'to' => true],
        ]));
    });

    it('does not auto-default on enabling or a role change when a default exists', function () {
        printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        $off = printerIn($this->branch, ['name' => 'Off', 'is_enabled' => false]);
        $counter = printerIn($this->branch, ['name' => 'Counter', 'role' => 'cashier']);

        patchPrinter($off, ['is_enabled' => true])->assertOk()->assertJsonPath('data.is_default_kitchen', false);
        patchPrinter($counter, ['role' => 'kitchen'])->assertOk()->assertJsonPath('data.is_default_kitchen', false);
    });

    it('makes an enabled cashier printer the default when its role changes to kitchen or bar and the branch has none (Q-005)', function (string $role, array $extra) {
        $counter = printerIn($this->branch, ['name' => 'Counter', 'role' => 'cashier']);

        patchPrinter($counter, ['role' => $role, ...$extra])
            ->assertOk()
            ->assertJsonPath('data.role', $role)
            ->assertJsonPath('data.is_default_kitchen', true);

        expect(ksortDeep(lastAudit('printer.updated')->changes))->toBe(ksortDeep([
            'role' => ['from' => 'cashier', 'to' => $role],
            'is_default_kitchen' => ['from' => false, 'to' => true],
        ]));
    })->with([
        'kitchen' => ['kitchen', []],
        'bar' => ['bar', []],
        'explicit false' => ['kitchen', ['is_default_kitchen' => false]],
    ]);

    it('does not auto-default a disabled printer whose role changes, or a kitchen printer that becomes a bar printer', function () {
        $offCounter = printerIn($this->branch, ['name' => 'Off Counter', 'role' => 'cashier', 'is_enabled' => false]);
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen']);

        patchPrinter($offCounter, ['role' => 'kitchen'])->assertOk()->assertJsonPath('data.is_default_kitchen', false);
        patchPrinter($kitchen, ['role' => 'bar'])->assertOk()->assertJsonPath('data.is_default_kitchen', false);
    });

    it('does not reassign the default when the default printer is disabled, made a cashier or deleted', function () {
        $default = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        $bar = printerIn($this->branch, ['name' => 'Bar', 'role' => 'bar']);

        patchPrinter($default, ['is_enabled' => false])->assertOk()->assertJsonPath('data.is_default_kitchen', true);
        patchPrinter($default, ['role' => 'cashier'])->assertOk()->assertJsonPath('data.is_default_kitchen', false);

        expect($bar->fresh()->is_default_kitchen)->toBeFalse();

        $other = printerIn($this->branch, ['name' => 'Grill', 'is_default_kitchen' => true]);
        $this->withToken($this->token)->deleteJson("/api/v1/admin/printers/{$other->id}")->assertNoContent();

        expect($bar->fresh()->is_default_kitchen)->toBeFalse()
            ->and(Printer::query()->where('is_default_kitchen', true)->count())->toBe(0);
    });

    it('lets an admin unset the default, leaving the branch with none', function () {
        $kitchen = printerIn($this->branch, ['is_default_kitchen' => true]);

        patchPrinter($kitchen, ['is_default_kitchen' => false])->assertOk()->assertJsonPath('data.is_default_kitchen', false);

        expect(Printer::query()->where('is_default_kitchen', true)->count())->toBe(0);
    });
});

describe('routes', function () {
    it('moves a category routed to another printer, audited on both printers', function () {
        storePrinter(printerBody(['category_ids' => [$this->breakfast->id, $this->meals->id]]))->assertCreated();
        $kitchen = Printer::query()->where('name', 'Kitchen')->sole();

        Carbon::setTestNow('2026-09-25 02:10:00');

        $bar = storePrinter(printerBody(['name' => 'Bar', 'role' => 'bar', 'category_ids' => [$this->meals->id, $this->drinks->id]]))
            ->assertCreated()
            ->assertJsonPath('data.category_ids', [$this->meals->id, $this->drinks->id])
            ->json('data');

        $this->withToken($this->token)->getJson("/api/v1/admin/printers/{$kitchen->id}")
            ->assertOk()
            ->assertJsonPath('data.category_ids', [$this->breakfast->id])
            ->assertJsonPath('data.updated_at', '2026-09-25T02:10:00Z');

        expect(PrintRoute::query()->where('category_id', $this->meals->id)->sole()->printer_id)->toBe($bar['id'])
            ->and(lastAudit('printer.updated')->subject_id)->toBe($kitchen->id)
            ->and(ksortDeep(lastAudit('printer.updated')->changes))->toBe([
                'category_ids' => ['from' => [$this->breakfast->id, $this->meals->id], 'to' => [$this->breakfast->id]],
            ])
            ->and(ksortDeep(lastAudit('printer.created')->changes['category_ids']))->toBe(['from' => null, 'to' => [$this->meals->id, $this->drinks->id]]);
    });

    it('replaces the routes on update and touches updated_at when only the routes change', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen']);
        routeTo($kitchen, [$this->breakfast, $this->meals]);
        $bar = printerIn($this->branch, ['name' => 'Bar', 'role' => 'bar']);
        routeTo($bar, [$this->drinks]);

        Carbon::setTestNow('2026-09-25 03:00:00');

        patchPrinter($kitchen, ['category_ids' => [$this->drinks->id, $this->breakfast->id]])
            ->assertOk()
            ->assertJsonPath('data.category_ids', [$this->breakfast->id, $this->drinks->id])
            ->assertJsonPath('data.updated_at', '2026-09-25T03:00:00Z');

        expect(AuditLog::query()->where('action', 'printer.updated')->orderBy('id')->get()->map(fn (AuditLog $a) => [$a->subject_id, ksortDeep($a->changes)])->all())
            ->toBe([
                [$kitchen->id, ['category_ids' => ['from' => [$this->breakfast->id, $this->meals->id], 'to' => [$this->breakfast->id, $this->drinks->id]]]],
                [$bar->id, ['category_ids' => ['from' => [$this->drinks->id], 'to' => []]]],
            ])
            ->and($bar->fresh()->updated_at->toIso8601ZuluString())->toBe('2026-09-25T03:00:00Z')
            ->and(PrintRoute::query()->where('printer_id', $kitchen->id)->orderBy('category_id')->pluck('category_id')->all())
            ->toBe([$this->breakfast->id, $this->drinks->id]);
    });

    it('clears the routes with an empty list', function () {
        $kitchen = printerIn($this->branch);
        routeTo($kitchen, [$this->breakfast]);

        patchPrinter($kitchen, ['category_ids' => []])->assertOk()->assertJsonPath('data.category_ids', []);

        expect(PrintRoute::query()->count())->toBe(0);
    });

    it('keeps the routes when category_ids is not sent', function () {
        $kitchen = printerIn($this->branch);
        routeTo($kitchen, [$this->breakfast]);

        patchPrinter($kitchen, ['name' => 'Hot Line'])->assertOk()->assertJsonPath('data.category_ids', [$this->breakfast->id]);
    });

    it('rejects categories on a cashier printer, and allows them when the same request makes it a kitchen printer', function () {
        $counter = printerIn($this->branch, ['role' => 'cashier']);

        patchPrinter($counter, ['category_ids' => [$this->breakfast->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_ids' => "Receipt printers don't take categories."]);

        patchPrinter($counter, ['is_default_kitchen' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['is_default_kitchen' => 'Only a kitchen or bar printer can be the default kitchen printer.']);

        patchPrinter($counter, ['role' => 'kitchen', 'category_ids' => [$this->breakfast->id]])
            ->assertOk()
            ->assertJsonPath('data.category_ids', [$this->breakfast->id]);
    });

    it('rejects making a printer a cashier together with the default flag or categories', function () {
        $kitchen = printerIn($this->branch);

        patchPrinter($kitchen, ['role' => 'cashier', 'is_default_kitchen' => true])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['is_default_kitchen']);

        patchPrinter($kitchen, ['role' => 'cashier', 'category_ids' => [$this->meals->id]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category_ids']);
    });
});

describe('update', function () {
    it('changes only the fields sent and audits them as {from, to}', function () {
        $printer = printerIn($this->branch, ['name' => 'Kitchen', 'host' => '192.168.1.60', 'port' => 9100]);

        Carbon::setTestNow('2026-09-25 04:00:00');

        $response = patchPrinter($printer, ['host' => '192.168.1.61', 'port' => 9101, 'paper_width_mm' => 58])->assertOk();

        expect(array_keys($response->json('data')))->toBe(printerKeys());
        $response->assertJsonPath('data.name', 'Kitchen')
            ->assertJsonPath('data.host', '192.168.1.61')
            ->assertJsonPath('data.port', 9101)
            ->assertJsonPath('data.paper_width_mm', 58)
            ->assertJsonPath('data.updated_at', '2026-09-25T04:00:00Z');

        $audit = lastAudit('printer.updated');
        expect($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->subject_id)->toBe($printer->id)
            ->and(ksortDeep($audit->changes))->toBe(ksortDeep([
                'host' => ['from' => '192.168.1.60', 'to' => '192.168.1.61'],
                'port' => ['from' => 9100, 'to' => 9101],
                'paper_width_mm' => ['from' => 80, 'to' => 58],
            ]))
            ->and($printer->fresh()->updated_by)->toBe($this->manager->id);
    });

    it('writes nothing when nothing changes', function () {
        $printer = printerIn($this->branch, ['name' => 'Kitchen', 'port' => 9100]);
        routeTo($printer, [$this->meals]);

        Carbon::setTestNow('2026-09-25 04:00:00');

        patchPrinter($printer, ['name' => 'Kitchen', 'port' => 9100, 'category_ids' => [$this->meals->id]])
            ->assertOk()
            ->assertJsonPath('data.updated_at', '2026-09-25T02:00:00Z');

        expect(AuditLog::query()->count())->toBe(0);
    });

    it('allows keeping its own name in another case, but not another printer name', function () {
        $printer = printerIn($this->branch, ['name' => 'Kitchen']);
        printerIn($this->branch, ['name' => 'Bar']);

        patchPrinter($printer, ['name' => 'KITCHEN'])->assertOk()->assertJsonPath('data.name', 'KITCHEN');
        patchPrinter($printer, ['name' => 'bar'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['name' => 'The name has already been taken.']);
    });

    it('rejects null for every field', function (string $field, string $message) {
        $printer = printerIn($this->branch);

        patchPrinter($printer, [$field => null])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([$field => $message]);
    })->with([
        ['name', 'The name field is required.'],
        ['role', 'The role field is required.'],
        ['host', 'The host field is required.'],
        ['port', 'The port field is required.'],
        ['is_enabled', 'The is enabled field is required.'],
        ['is_default_kitchen', 'The is default kitchen field is required.'],
        ['category_ids', 'The category ids field must be an array.'],
    ]);

    it('clears the routes and the default flag when the role changes to cashier', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        routeTo($kitchen, [$this->breakfast, $this->meals]);

        patchPrinter($kitchen, ['role' => 'cashier'])
            ->assertOk()
            ->assertJsonPath('data.role', 'cashier')
            ->assertJsonPath('data.is_default_kitchen', false)
            ->assertJsonPath('data.category_ids', []);

        expect(PrintRoute::query()->count())->toBe(0)
            ->and(ksortDeep(lastAudit('printer.updated')->changes))->toBe(ksortDeep([
                'role' => ['from' => 'kitchen', 'to' => 'cashier'],
                'is_default_kitchen' => ['from' => true, 'to' => false],
                'category_ids' => ['from' => [$this->breakfast->id, $this->meals->id], 'to' => []],
            ]));
    });
});

describe('destroy', function () {
    it('soft-deletes the printer, removes its routes, clears its flag and audits it', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen', 'is_default_kitchen' => true]);
        routeTo($kitchen, [$this->breakfast]);
        $bar = printerIn($this->branch, ['name' => 'Bar', 'role' => 'bar']);
        routeTo($bar, [$this->drinks]);

        $this->withToken($this->token)->deleteJson("/api/v1/admin/printers/{$kitchen->id}")->assertNoContent();

        $deleted = Printer::withTrashed()->find($kitchen->id);
        expect($deleted->trashed())->toBeTrue()
            ->and($deleted->is_default_kitchen)->toBeFalse()
            ->and($deleted->updated_by)->toBe($this->manager->id)
            ->and(PrintRoute::query()->pluck('printer_id')->all())->toBe([$bar->id])
            ->and($bar->fresh()->is_default_kitchen)->toBeFalse(); // no automatic reassignment

        $audit = lastAudit('printer.deleted');
        expect($audit->subject_id)->toBe($kitchen->id)
            ->and($audit->actor_id)->toBe($this->manager->id)
            ->and($audit->changes)->toBe(['name' => 'Kitchen']);

        $this->withToken($this->token)->getJson("/api/v1/admin/printers/{$kitchen->id}")->assertNotFound();
        $this->withToken($this->token)->deleteJson("/api/v1/admin/printers/{$kitchen->id}")->assertNotFound();
    });

    it('frees the category for another printer', function () {
        $kitchen = printerIn($this->branch, ['name' => 'Kitchen']);
        routeTo($kitchen, [$this->breakfast]);

        $this->withToken($this->token)->deleteJson("/api/v1/admin/printers/{$kitchen->id}")->assertNoContent();

        storePrinter(printerBody(['name' => 'Grill', 'category_ids' => [$this->breakfast->id]]))
            ->assertCreated()
            ->assertJsonPath('data.category_ids', [$this->breakfast->id]);
    });
});

describe('branch isolation', function () {
    it('never touches another branch printers or routes', function () {
        $north = userWithRole('manager');
        $north->forceFill(['branch_id' => $this->otherBranch->id])->save();
        $northKitchen = printerIn($this->otherBranch, ['name' => 'North Kitchen', 'is_default_kitchen' => true]);
        routeTo($northKitchen, [$this->meals]);

        storePrinter(printerBody(['is_default_kitchen' => true, 'category_ids' => [$this->meals->id]]))->assertCreated();

        expect($northKitchen->fresh()->is_default_kitchen)->toBeTrue()
            ->and($northKitchen->routedCategoryIds())->toBe([$this->meals->id])
            ->and(PrintRoute::query()->where('category_id', $this->meals->id)->count())->toBe(2);

        $this->withToken(tokenFor($north))->getJson('/api/v1/admin/printers')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $northKitchen->id);
    });
});
