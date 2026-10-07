<?php

use App\Support\Sales\Discount;
use App\Support\Sales\PricedLine;
use App\Support\Sales\PricedSale;
use App\Support\Sales\SaleCalculator;
use App\Support\Sales\SaleLine;
use App\Support\Sales\ScPwd;

function scPwdCalculator(): SaleCalculator
{
    return new SaleCalculator(1200, 2000);
}

function oneSenior(string $mode = ScPwd::MODE_ITEMS, ?int $diners = null, bool $vatExempt = true): ScPwd
{
    return new ScPwd($mode, [['type' => 'senior_citizen', 'id_no' => 'OSCA-12345']], $diners, $vatExempt);
}

/**
 * @return array<string, int|bool>
 */
function scPwdLineFigures(PricedLine $line): array
{
    return [
        'gross' => $line->grossCents,
        'sc_pwd' => $line->scPwd,
        'E' => $line->scPwdEligibleCents,
        'R' => $line->scPwdVatReliefCents,
        'S' => $line->scPwdDiscountCents,
        'X' => $line->scPwdExemptCents,
        'line_total' => $line->lineTotalCents,
    ];
}

/**
 * @return array<string, int>
 */
function scPwdTotals(PricedSale $sale): array
{
    return [
        'subtotal' => $sale->subtotalCents,
        'line_discounts' => $sale->lineDiscountsCents,
        'R' => $sale->scPwdVatReliefCents,
        'S' => $sale->scPwdDiscountCents,
        'discount' => $sale->discountCents,
        'total' => $sale->totalCents,
        'vatable_sales' => $sale->vatableSalesCents,
        'vat' => $sale->vatAmountCents,
        'vat_exempt' => $sale->vatExemptSalesCents,
    ];
}

/**
 * Example D's cart: Meal ₱250 (marked), Iced Tea ₱45 (marked), Meal ₱250; all VAT-able.
 *
 * @return list<SaleLine>
 */
function exampleDLines(): array
{
    return [
        new SaleLine(25000, 1, true, null, true),
        new SaleLine(4500, 1, true, null, true),
        new SaleLine(25000, 1, true),
    ];
}

describe('worked examples (SC/PWD contract)', function () {
    it('prices example D (items mode, one senior, VAT exempt) exactly, line by line', function () {
        $sale = scPwdCalculator()->price(exampleDLines(), null, oneSenior());

        expect(array_map(scPwdLineFigures(...), $sale->lines))->toBe([
            ['gross' => 25000, 'sc_pwd' => true, 'E' => 25000, 'R' => 2679, 'S' => 4464, 'X' => 17857, 'line_total' => 17857],
            ['gross' => 4500, 'sc_pwd' => true, 'E' => 4500, 'R' => 482, 'S' => 804, 'X' => 3214, 'line_total' => 3214],
            ['gross' => 25000, 'sc_pwd' => false, 'E' => 0, 'R' => 0, 'S' => 0, 'X' => 0, 'line_total' => 25000],
        ])
            ->and(scPwdTotals($sale))->toBe([
                'subtotal' => 54500, 'line_discounts' => 0, 'R' => 3161, 'S' => 5268, 'discount' => 8429,
                'total' => 46071, 'vatable_sales' => 22321, 'vat' => 2679, 'vat_exempt' => 21071,
            ])
            ->and($sale->orderDiscountCents)->toBe(0)
            ->and($sale->regularDiscountCents())->toBe(0)
            // The senior pays ₱210.71 (= ₱295 ÷ 1.12 × 0.8).
            ->and($sale->lines[0]->lineTotalCents + $sale->lines[1]->lineTotalCents)->toBe(21071);
    });

    it('prices example F (example D with vat_exempt false) exactly, line by line', function () {
        $sale = scPwdCalculator()->price(exampleDLines(), null, oneSenior(vatExempt: false));

        expect(array_map(scPwdLineFigures(...), $sale->lines))->toBe([
            ['gross' => 25000, 'sc_pwd' => true, 'E' => 25000, 'R' => 0, 'S' => 5000, 'X' => 0, 'line_total' => 20000],
            ['gross' => 4500, 'sc_pwd' => true, 'E' => 4500, 'R' => 0, 'S' => 900, 'X' => 0, 'line_total' => 3600],
            ['gross' => 25000, 'sc_pwd' => false, 'E' => 0, 'R' => 0, 'S' => 0, 'X' => 0, 'line_total' => 25000],
        ])
            ->and(scPwdTotals($sale))->toBe([
                'subtotal' => 54500, 'line_discounts' => 0, 'R' => 0, 'S' => 5900, 'discount' => 5900,
                'total' => 48600, 'vatable_sales' => 43393, 'vat' => 5207, 'vat_exempt' => 0,
            ])
            // The senior pays ₱236.00 (= ₱295 × 0.8).
            ->and($sale->lines[0]->lineTotalCents + $sale->lines[1]->lineTotalCents)->toBe(23600);
    });

    it('prices example E (headcount mode, 4 diners, 1 senior, VAT exempt) exactly, line by line', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(80000, 1, true),
            new SaleLine(12000, 2, true),
            new SaleLine(6000, 1, false),
        ], null, oneSenior(ScPwd::MODE_HEADCOUNT, 4));

        expect(array_map(scPwdLineFigures(...), $sale->lines))->toBe([
            ['gross' => 80000, 'sc_pwd' => true, 'E' => 20000, 'R' => 2143, 'S' => 3572, 'X' => 14285, 'line_total' => 74285],
            ['gross' => 24000, 'sc_pwd' => true, 'E' => 6000, 'R' => 643, 'S' => 1071, 'X' => 4286, 'line_total' => 22286],
            ['gross' => 6000, 'sc_pwd' => true, 'E' => 1500, 'R' => 0, 'S' => 300, 'X' => 1200, 'line_total' => 5700],
        ])
            ->and(scPwdTotals($sale))->toBe([
                'subtotal' => 110000, 'line_discounts' => 0, 'R' => 2786, 'S' => 4943, 'discount' => 7729,
                'total' => 102271, 'vatable_sales' => 69643, 'vat' => 8357, 'vat_exempt' => 24271,
            ])
            // The senior's share is ₱197.71.
            ->and(array_sum(array_map(fn (PricedLine $l) => $l->scPwdEligibleCents - $l->scPwdVatReliefCents - $l->scPwdDiscountCents, $sale->lines)))->toBe(19771);
    });
});

describe('reduction to Phase 3 without SC/PWD', function () {
    it('leaves example A unchanged, with every SC/PWD figure 0', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(5000, 2, true),
            new SaleLine(3500, 1, true),
        ]);

        expect(scPwdTotals($sale))->toBe([
            'subtotal' => 13500, 'line_discounts' => 0, 'R' => 0, 'S' => 0, 'discount' => 0,
            'total' => 13500, 'vatable_sales' => 12054, 'vat' => 1446, 'vat_exempt' => 0,
        ])
            ->and($sale->scPwd)->toBeNull()
            ->and(array_map(fn (PricedLine $l) => [$l->scPwd, $l->scPwdEligibleCents, $l->scPwdVatReliefCents, $l->scPwdDiscountCents, $l->scPwdExemptCents], $sale->lines))
            ->toBe([[false, 0, 0, 0, 0], [false, 0, 0, 0, 0]]);
    });

    it('leaves example B unchanged (step E reduces to step 8)', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(8000, 1, true, new Discount('promo', 'percent', 1000)),
            new SaleLine(4500, 2, false),
            new SaleLine(3500, 3, true),
        ], new Discount('promo', 'amount', 1000));

        expect(scPwdTotals($sale))->toBe([
            'subtotal' => 27500, 'line_discounts' => 800, 'R' => 0, 'S' => 0, 'discount' => 1800,
            'total' => 25700, 'vatable_sales' => 15212, 'vat' => 1825, 'vat_exempt' => 8663,
        ])
            ->and($sale->regularDiscountCents())->toBe(1800)
            ->and(array_column(array_map(scPwdLineFigures(...), $sale->lines), 'line_total'))->toBe([6930, 8663, 10107]);
    });
});

describe('SC/PWD rules', function () {
    it('keeps a regular line discount on an unmarked line in items mode, outside the SC/PWD', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(25000, 1, true, null, true),
            new SaleLine(10000, 1, true, new Discount('promo', 'percent', 1000)),
        ], null, oneSenior());

        // Line 1 as in example D's arithmetic: base = rhu(25000 × 10000, 11200) = 22321.
        expect($sale->lineDiscountsCents)->toBe(1000)
            ->and($sale->scPwdVatReliefCents)->toBe(2679)
            ->and($sale->scPwdDiscountCents)->toBe(4464)
            ->and($sale->discountCents)->toBe(1000 + 2679 + 4464)
            ->and($sale->regularDiscountCents())->toBe(1000)
            ->and($sale->totalCents)->toBe(35000 - 8143)
            ->and($sale->lines[1]->lineTotalCents)->toBe(9000)
            // T = only the unmarked line: 9000.
            ->and($sale->vatableSalesCents + $sale->vatAmountCents)->toBe(9000)
            ->and($sale->vatExemptSalesCents)->toBe(17857);
    });

    it('splits a shared meal among several persons', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(10000, 3, true),
        ], null, new ScPwd(ScPwd::MODE_HEADCOUNT, [
            ['type' => 'senior_citizen', 'id_no' => 'OSCA-1'],
            ['type' => 'pwd', 'id_no' => 'PWD-2'],
        ], 3, false));

        // E = rhu(30000 × 2, 3) = 20000; S = rhu(20000 × 2000, 10000) = 4000.
        expect(scPwdLineFigures($sale->lines[0]))->toBe(['gross' => 30000, 'sc_pwd' => true, 'E' => 20000, 'R' => 0, 'S' => 4000, 'X' => 0, 'line_total' => 26000])
            ->and($sale->discountCents)->toBe(4000)
            ->and($sale->vatExemptSalesCents)->toBe(0);
    });

    it('always keeps total = subtotal − discount = Σ line totals, and the VAT split adds up', function () {
        $sale = scPwdCalculator()->price([
            new SaleLine(1999, 7, true),
            new SaleLine(333, 3, false),
            new SaleLine(12345, 1, true),
            new SaleLine(1, 1, true),
        ], null, new ScPwd(ScPwd::MODE_HEADCOUNT, [
            ['type' => 'pwd', 'id_no' => 'A1'], ['type' => 'pwd', 'id_no' => 'A2'], ['type' => 'senior_citizen', 'id_no' => 'A3'],
        ], 7, true));

        $lineTotals = array_sum(array_map(fn (PricedLine $l) => $l->lineTotalCents, $sale->lines));

        expect($sale->totalCents)->toBe($sale->subtotalCents - $sale->discountCents)
            ->and($lineTotals)->toBe($sale->totalCents)
            ->and($sale->discountCents)->toBe($sale->scPwdVatReliefCents + $sale->scPwdDiscountCents)
            ->and($sale->vatableSalesCents + $sale->vatAmountCents + $sale->vatExemptSalesCents)->toBe($sale->totalCents)
            ->and(array_sum(array_map(fn (PricedLine $l) => $l->scPwdEligibleCents, $sale->lines)))->toBe(intdiv(27338 * 3 + 3, 7));
    });

    it('refuses SC/PWD combined with another discount, or a marked line without it', function (string $case) {
        $discount = new Discount('promo', 'amount', 100);

        $price = match ($case) {
            'order discount' => fn () => scPwdCalculator()->price(exampleDLines(), $discount, oneSenior()),
            'discount on a marked line' => fn () => scPwdCalculator()->price([new SaleLine(1000, 1, true, $discount, true)], null, oneSenior()),
            'line discount in headcount mode' => fn () => scPwdCalculator()->price([new SaleLine(1000, 1, true, $discount)], null, oneSenior(ScPwd::MODE_HEADCOUNT, 2)),
            'marked line in headcount mode' => fn () => scPwdCalculator()->price([new SaleLine(1000, 1, true, null, true)], null, oneSenior(ScPwd::MODE_HEADCOUNT, 2)),
            'marked line without SC/PWD' => fn () => scPwdCalculator()->price([new SaleLine(1000, 1, true, null, true)]),
        };

        expect($price)->toThrow(InvalidArgumentException::class);
    })->with([
        'order discount', 'discount on a marked line', 'line discount in headcount mode',
        'marked line in headcount mode', 'marked line without SC/PWD',
    ]);
});
