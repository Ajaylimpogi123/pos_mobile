<?php

use App\Support\Money;
use App\Support\Sales\Discount;
use App\Support\Sales\PricedLine;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\SalePricingException;

function calculator(): SaleCalculator
{
    return new SaleCalculator(1200);
}

/**
 * @return array<string, int>
 */
function lineFigures(PricedLine $line): array
{
    return [
        'gross' => $line->grossCents,
        'line_discount' => $line->lineDiscountCents,
        'net' => $line->netCents,
        'share' => $line->orderDiscountShareCents,
        'line_total' => $line->lineTotalCents,
    ];
}

function pricingError(Closure $price): SalePricingException
{
    try {
        $price();
    } catch (SalePricingException $e) {
        return $e;
    }

    throw new RuntimeException('Expected a SalePricingException.');
}

describe('worked examples (Phase 3 contract)', function () {
    it('prices example A (no discount) exactly', function () {
        $sale = calculator()->price([
            new SaleLine(5000, 2, true),
            new SaleLine(3500, 1, true),
        ]);

        expect($sale->subtotalCents)->toBe(13500)
            ->and($sale->lineDiscountsCents)->toBe(0)
            ->and($sale->orderDiscountCents)->toBe(0)
            ->and($sale->discountCents)->toBe(0)
            ->and($sale->totalCents)->toBe(13500)
            ->and($sale->vatableSalesCents)->toBe(12054)
            ->and($sale->vatAmountCents)->toBe(1446)
            ->and($sale->vatExemptSalesCents)->toBe(0)
            ->and(array_map(lineFigures(...), $sale->lines))->toBe([
                ['gross' => 10000, 'line_discount' => 0, 'net' => 10000, 'share' => 0, 'line_total' => 10000],
                ['gross' => 3500, 'line_discount' => 0, 'net' => 3500, 'share' => 0, 'line_total' => 3500],
            ]);
    });

    it('prices example B (line + order discount, largest remainder, VAT once) exactly', function () {
        $sale = calculator()->price([
            new SaleLine(8000, 1, true, new Discount('promo', 'percent', 1000)),
            new SaleLine(4500, 2, false),
            new SaleLine(3500, 3, true),
        ], new Discount('promo', 'amount', 1000));

        expect(array_map(lineFigures(...), $sale->lines))->toBe([
            // 1000 × 7200 / 26700 = 269 r 17700 (largest remainder: +1)
            ['gross' => 8000, 'line_discount' => 800, 'net' => 7200, 'share' => 270, 'line_total' => 6930],
            ['gross' => 9000, 'line_discount' => 0, 'net' => 9000, 'share' => 337, 'line_total' => 8663],
            ['gross' => 10500, 'line_discount' => 0, 'net' => 10500, 'share' => 393, 'line_total' => 10107],
        ])
            ->and($sale->subtotalCents)->toBe(27500)
            ->and($sale->lineDiscountsCents)->toBe(800)
            ->and($sale->orderDiscountCents)->toBe(1000)
            ->and($sale->discountCents)->toBe(1800)
            ->and($sale->totalCents)->toBe(25700)
            ->and($sale->vatableSalesCents)->toBe(15212)
            ->and($sale->vatAmountCents)->toBe(1825)
            ->and($sale->vatExemptSalesCents)->toBe(8663);
    });
});

describe('allocation', function () {
    it('gives tied remainders to the lower line index', function () {
        // 1 centavo over three equal lines: every remainder ties, so line 0 gets it.
        expect(SaleCalculator::allocate(1, [100, 100, 100]))->toBe([1, 0, 0])
            ->and(SaleCalculator::allocate(2, [100, 100, 100]))->toBe([1, 1, 0])
            // Remainders 2/3 → 200, 100, 200 (W = 300): the ties at 200 go to lines 0 and 2.
            ->and(SaleCalculator::allocate(2, [100, 50, 100, 50]))->toBe([1, 0, 1, 0]);
    });

    it('prefers the largest remainder over the lower index', function () {
        // 3 × 1/7 = 0 r 3, 3 × 6/7 = 2 r 4: the leftover centavo goes to the second line.
        expect(SaleCalculator::allocate(3, [1, 6]))->toBe([0, 3]);
    });

    it('allocates exactly the amount and never more than a line\'s weight', function () {
        $weights = [7, 0, 13, 1, 29, 5];

        foreach (range(0, 55) as $amount) {
            $shares = SaleCalculator::allocate($amount, $weights);

            expect(array_sum($shares))->toBe($amount);

            foreach ($weights as $i => $weight) {
                expect($shares[$i])->toBeLessThanOrEqual($weight)->toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('gives every line 0 when the base B is 0', function () {
        expect(SaleCalculator::allocate(0, [0, 0]))->toBe([0, 0]);

        $sale = calculator()->price([
            new SaleLine(0, 2, true),
            new SaleLine(0, 1, false),
        ], new Discount('manual', 'percent', 5000));

        expect($sale->orderDiscountCents)->toBe(0)
            ->and(array_map(fn (PricedLine $l) => $l->orderDiscountShareCents, $sale->lines))->toBe([0, 0])
            ->and($sale->totalCents)->toBe(0)
            ->and($sale->vatableSalesCents)->toBe(0)
            ->and($sale->vatAmountCents)->toBe(0);
    });
});

describe('discounts', function () {
    it('rounds percent discounts half up', function () {
        // 3333 × 1500 / 10000 = 499.95 → 500; 3333 × 1499 / 10000 = 499.6167 → 500; 101 × 5000 / 10000 = 50.5 → 51
        expect(calculator()->price([new SaleLine(3333, 1, true, new Discount('promo', 'percent', 1500))])->lineDiscountsCents)->toBe(500)
            ->and(calculator()->price([new SaleLine(101, 1, true, new Discount('promo', 'percent', 5000))])->lineDiscountsCents)->toBe(51)
            ->and(calculator()->price([new SaleLine(100, 1, true, new Discount('promo', 'percent', 1))])->lineDiscountsCents)->toBe(0);
    });

    it('accepts a discount equal to its base', function () {
        $line = calculator()->price([new SaleLine(2500, 2, true, new Discount('employee', 'amount', 5000))]);
        expect($line->totalCents)->toBe(0)->and($line->discountCents)->toBe(5000);

        $order = calculator()->price([new SaleLine(2500, 2, true)], new Discount('manual', 'amount', 5000));
        expect($order->totalCents)->toBe(0)
            ->and($order->orderDiscountCents)->toBe(5000)
            ->and($order->vatableSalesCents)->toBe(0)
            ->and($order->vatAmountCents)->toBe(0);

        $full = calculator()->price([new SaleLine(1999, 3, false)], new Discount('manual', 'percent', 10000));
        expect($full->totalCents)->toBe(0);
    });

    it('rejects a line discount above its line, with the line index and base', function () {
        $e = pricingError(fn () => calculator()->price([
            new SaleLine(1000, 1, true),
            new SaleLine(2500, 2, true, new Discount('promo', 'amount', 5001)),
        ]));

        expect($e->lineDiscountBases)->toBe([1 => 5000])
            ->and($e->orderDiscountBase)->toBeNull()
            ->and($e->tooLarge)->toBeFalse();
    });

    it('rejects an order discount above the base B (after line discounts)', function () {
        $e = pricingError(fn () => calculator()->price([
            new SaleLine(8000, 1, true, new Discount('promo', 'percent', 1000)), // net 7200
            new SaleLine(1000, 1, true),                                          // net 1000
        ], new Discount('manual', 'amount', 8201)));

        expect($e->lineDiscountBases)->toBe([])
            ->and($e->orderDiscountBase)->toBe(8200)
            ->and($e->tooLarge)->toBeFalse();
    });

    it('rejects any amount order discount when B is 0', function () {
        $e = pricingError(fn () => calculator()->price([new SaleLine(0, 1, true)], new Discount('manual', 'amount', 1)));

        expect($e->orderDiscountBase)->toBe(0);
    });
});

describe('VAT', function () {
    it('rounds VAT once per order, not per line', function () {
        // Per line: rhu(100 × 10000, 11200) = 89 each → 267 VATable, 33 VAT.
        // Per order: rhu(300 × 10000, 11200) = 268 VATable, 32 VAT.
        $sale = calculator()->price([
            new SaleLine(100, 1, true),
            new SaleLine(100, 1, true),
            new SaleLine(100, 1, true),
        ]);

        expect($sale->vatableSalesCents)->toBe(268)
            ->and($sale->vatAmountCents)->toBe(32)
            ->and($sale->vatableSalesCents + $sale->vatAmountCents + $sale->vatExemptSalesCents)->toBe($sale->totalCents);
    });

    it('uses the given rate', function () {
        expect(calculator()->price([new SaleLine(11200, 1, true)])->vatableSalesCents)->toBe(10000)
            ->and((new SaleCalculator(0))->price([new SaleLine(11200, 1, true)])->vatAmountCents)->toBe(0)
            ->and((new SaleCalculator(500))->price([new SaleLine(10500, 1, true)])->vatAmountCents)->toBe(500);
    });

    it('keeps VAT-exempt lines out of VAT', function () {
        $sale = calculator()->price([new SaleLine(4500, 2, false)]);

        expect($sale->vatableSalesCents)->toBe(0)
            ->and($sale->vatAmountCents)->toBe(0)
            ->and($sale->vatExemptSalesCents)->toBe(9000);
    });
});

describe('size limit', function () {
    it('accepts a subtotal of exactly ₱10,000,000', function () {
        $sale = calculator()->price(
            array_fill(0, 10, new SaleLine(100000000, 1, true)),
            new Discount('manual', 'amount', 999999999),
        );

        expect($sale->subtotalCents)->toBe(1000000000)
            ->and($sale->totalCents)->toBe(1)
            ->and(array_sum(array_map(fn (PricedLine $l) => $l->orderDiscountShareCents, $sale->lines)))->toBe(999999999);
    });

    it('rejects a larger subtotal, even at the maximum line count and qty, without overflowing', function () {
        $e = pricingError(fn () => calculator()->price(
            array_fill(0, 100, new SaleLine(100000000, 999, true, new Discount('promo', 'percent', 10000))),
            new Discount('manual', 'percent', 10000),
        ));

        expect($e->tooLarge)->toBeTrue()
            ->and($e->lineDiscountBases)->toBe([])
            ->and($e->orderDiscountBase)->toBeNull();

        $justOver = pricingError(fn () => calculator()->price([new SaleLine(1000000001, 1, true)]));
        expect($justOver->tooLarge)->toBeTrue();
    });

    it('reports every pricing problem at once', function () {
        $e = pricingError(fn () => calculator()->price([
            new SaleLine(100000000, 11, true, new Discount('promo', 'amount', 1000000000)),
            new SaleLine(100, 1, true, new Discount('promo', 'amount', 101)),
        ]));

        expect($e->lineDiscountBases)->toBe([1 => 100])
            ->and($e->tooLarge)->toBeTrue();
    });
});

describe('Money', function () {
    it('rounds half up', function () {
        expect(Money::roundHalfUp(5, 10))->toBe(1)
            ->and(Money::roundHalfUp(4, 10))->toBe(0)
            ->and(Money::roundHalfUp(15, 10))->toBe(2)
            ->and(Money::roundHalfUp(0, 7))->toBe(0)
            ->and(Money::roundHalfUp(403000, 12))->toBe(33583);
    });

    it('formats pesos with thousands separators and two decimals', function () {
        expect(Money::format(125050))->toBe('₱1,250.50')
            ->and(Money::format(800))->toBe('₱8.00')
            ->and(Money::format(5))->toBe('₱0.05')
            ->and(Money::format(0))->toBe('₱0.00')
            ->and(Money::format(1000000000))->toBe('₱10,000,000.00')
            ->and(Money::format(-4300))->toBe('-₱43.00');
    });
});
