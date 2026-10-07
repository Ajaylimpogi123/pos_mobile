<?php

use App\Support\Units\UnitConversion;

beforeEach(function () {
    seedRoles();
    $this->branch = mainBranch();
    $this->cashier = userWithRole('cashier');

    $this->flour = makeIngredient('Flour', 'g', ['sack' => '25000', 'cup' => '120']);
    $this->milk = makeIngredient('Milk', 'mL');
});

describe('GET /units', function () {
    it('lists the seeded catalog with exact factors to any authenticated user', function () {
        $response = $this->withToken(tokenFor($this->cashier))->getJson('/api/v1/units')->assertOk();

        expect($response->json('data'))->toHaveCount(17)
            ->and($response->json('data.0'))->toBe(['code' => 'mg', 'name' => 'Milligram', 'dimension' => 'mass', 'factor_to_base' => '0.001'])
            ->and(collect($response->json('data'))->pluck('factor_to_base', 'code')->all())->toBe([
                'mg' => '0.001', 'g' => '1', 'kg' => '1000', 'oz' => '28.349523125', 'lb' => '453.59237',
                'mL' => '1', 'L' => '1000', 'tsp' => '4.92892159375', 'tbsp' => '14.78676478125',
                'fl oz' => '29.5735295625', 'cup' => '236.5882365', 'pt' => '473.176473', 'qt' => '946.352946',
                'gal' => '3785.411784', 'pc' => '1', 'dozen' => '12', 'half dozen' => '6',
            ]);
    });

    it('needs a token', function () {
        $this->getJson('/api/v1/units')->assertUnauthorized();
    });
});

describe('worked example G', function () {
    it('converts exactly with round half up to 3 decimals', function (string $ingredient, string $qty, string $unit, string $base) {
        $item = $this->{$ingredient};
        $resolved = UnitConversion::forIngredient($item, $unit);

        expect($resolved)->not->toBeNull()
            ->and((string) UnitConversion::toBase($qty, $resolved->factor))->toBe($base);
    })->with([
        'Flour 2 sack' => ['flour', '2', 'sack', '50000.000'],
        'Flour 1.5 cup (own unit, a density)' => ['flour', '1.5', 'cup', '180.000'],
        'Flour 8 oz' => ['flour', '8', 'oz', '226.796'],
        'Milk 1 cup (catalog)' => ['milk', '1', 'cup', '236.588'],
        'Milk 2 tbsp' => ['milk', '2', 'tbsp', '29.574'],
    ]);

    it('refuses a unit the ingredient does not have', function () {
        expect(UnitConversion::forIngredient($this->flour, 'tbsp'))->toBeNull()
            ->and(UnitConversion::unknownMessage('tbsp', 'Flour'))->toBe('Add "tbsp" to Flour\'s units first.');
    });

    it('matches units case-insensitively and answers the canonical spelling', function () {
        expect(UnitConversion::forIngredient($this->milk, 'ml')?->name)->toBe('mL')
            ->and(UnitConversion::forIngredient($this->flour, 'SACK')?->name)->toBe('sack')
            ->and(UnitConversion::forProduct('PC')?->name)->toBe('pc')
            ->and(UnitConversion::forProduct('kg'))->toBeNull();
    });

    it('gives an own unit precedence over a catalog code', function () {
        // Flour's own `cup` (120 g) wins; the volume `cup` isn't valid for a mass ingredient anyway.
        expect(UnitConversion::forIngredient($this->flour, 'cup')?->factor)->toBe('120');
    });

    it('reserves the catalog codes of the ingredient\'s own dimension only', function () {
        expect(UnitConversion::isReserved('g', 'kg'))->toBeTrue()
            ->and(UnitConversion::isReserved('g', 'KG'))->toBeTrue()
            ->and(UnitConversion::isReserved('g', 'cup'))->toBeFalse()
            ->and(UnitConversion::isReserved('mL', 'cup'))->toBeTrue()
            ->and(UnitConversion::isReserved('pc', 'dozen'))->toBeTrue();
    });
});

it('refuses the unknown unit on a request with the contract message (422 on the unit field)', function () {
    $manager = userWithRole('manager');

    postPurchaseRequest($manager, prBody([prItem($this->flour, makeSupplier(), '3', 'tbsp')]))
        ->assertUnprocessable()
        ->assertJsonPath('errors', ['items.0.unit' => ['Add "tbsp" to Flour\'s units first.']]);
});
