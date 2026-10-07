<?php

use App\Support\Sales\RefundCalculator;

it('computes worked example C: 1 of 3 Iced Teas, then the other 2', function () {
    // Line 3 of worked example B: T = 10107, n = 3.
    expect(RefundCalculator::lineAmount(10107, 3, 0, 1))->toBe(3369)
        ->and(RefundCalculator::lineAmount(10107, 3, 1, 2))->toBe(6738)
        ->and(3369 + 6738)->toBe(10107);

    expect((new RefundCalculator(1200))->vatSplit(3369, 0))->toBe([
        'vatable_sales_cents' => 3008,
        'vat_amount_cents' => 361,
        'vat_exempt_sales_cents' => 0,
    ]);
});

it('always adds up to the line total, however the line is split', function (int $total, int $qty, array $parts) {
    $refunded = 0;
    $sum = 0;

    foreach ($parts as $part) {
        $sum += RefundCalculator::lineAmount($total, $qty, $refunded, $part);
        $refunded += $part;
    }

    expect($refunded)->toBe($qty)->and($sum)->toBe($total);
})->with([
    'one by one' => [10107, 3, [1, 1, 1]],
    'odd total in halves' => [8663, 2, [1, 1]],
    'uneven parts' => [99999, 7, [2, 1, 4]],
    'all at once' => [6930, 1, [1]],
    'zero total' => [0, 4, [3, 1]],
]);

it('splits a half-way line by rounding half up, cumulatively', function () {
    // T = 8663, n = 2: rhu(8663, 2) = 4332, then 8663 − 4332 = 4331.
    expect(RefundCalculator::lineAmount(8663, 2, 0, 1))->toBe(4332)
        ->and(RefundCalculator::lineAmount(8663, 2, 1, 1))->toBe(4331);
});

it('rounds VAT once per refund and keeps the exempt amount apart', function () {
    expect((new RefundCalculator(1200))->vatSplit(17037, 8663))->toBe([
        'vatable_sales_cents' => 15212,
        'vat_amount_cents' => 1825,
        'vat_exempt_sales_cents' => 8663,
    ]);
});

it('rejects quantities beyond the line', function () {
    RefundCalculator::lineAmount(10107, 3, 2, 2);
})->throws(InvalidArgumentException::class);

describe('SC/PWD taxable part (SC/PWD contract, *Refunds*)', function () {
    it('applies the cumulative formula to τ = line_total − X', function () {
        // Example E, Soda: T = 22286, τ = 18000, n = 2.
        expect(RefundCalculator::taxableAmount(11143, 18000, 2, 0, 1))->toBe(9000)
            ->and(RefundCalculator::taxableAmount(11143, 18000, 2, 1, 1))->toBe(9000)
            // Example D, a marked line: τ = 0, so the whole refund is VAT-exempt.
            ->and(RefundCalculator::taxableAmount(17857, 0, 1, 0, 1))->toBe(0)
            // Without SC/PWD, τ = T and the taxable part is the amount.
            ->and(RefundCalculator::taxableAmount(3369, 10107, 3, 0, 1))->toBe(3369);
    });

    it('keeps the taxable part within the amount when τ rounds ahead (Q-024)', function () {
        // T = 2, τ = 1, n = 3: the 2nd unit's amount is 0 while τ's cumulative share is 1.
        expect(RefundCalculator::lineAmount(2, 3, 1, 1))->toBe(0)
            ->and(RefundCalculator::lineAmount(1, 3, 1, 1))->toBe(1)
            ->and(RefundCalculator::taxableAmount(0, 1, 3, 1, 1))->toBe(0);
    });
});
