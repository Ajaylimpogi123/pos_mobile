<?php

namespace App\Actions\Shifts;

use App\Models\CashMovement;
use App\Models\Payment;
use App\Models\Shift;
use App\Support\Sales\SalesFigures;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The contract's `ShiftReport` (the X-read and the Z-read share it), computed live for
 * any number of shifts with **seven** aggregate queries, never one per shift:
 *
 * 1. the sales totals per shift (App\Support\Sales\SalesFigures, the dashboard's
 *    definitions) plus `needs_review_count`,
 * 2. the payments per shift and method (cash net of change),
 * 3. the sales per shift and cashier,
 * 4. the cash movements per shift and type,
 * 5. the voided orders per shift (Phase 7),
 * 6. the refunds per shift (Phase 7; the **refund's** shift),
 * 7. the money given back per shift and method (Phase 7).
 *
 * A shift's sales are the orders of its branch carrying its ULID that are not `voided`,
 * whenever they reached the server; its voids are the voided ones. Its refunds are those
 * made on its tablet in it (`refunds.shift_ulid`), whatever the sale's shift. Every cash
 * movement of the shift counts. Then:
 * `expected_cash_cents` = opening float + cash sales + cash in − cash out − cash refunds
 * (PROJECT_MEMORY §3.5), and `variance_cents` = counted − expected, `null` while there is no
 * count (open, or auto-closed and not yet counted; Q-012).
 */
class BuildShiftReports
{
    /**
     * Computes the report of each shift and sets it on the model (Shift::computedReport()).
     *
     * @param  iterable<Shift>  $shifts
     */
    public function execute(iterable $shifts): void
    {
        $shifts = collect($shifts)->values();

        if ($shifts->isEmpty()) {
            return;
        }

        $ids = $shifts->pluck('id')->all();
        $ulids = $shifts->pluck('ulid')->all();

        $totals = SalesFigures::selectTotals($this->ofShifts(SalesFigures::sales(), $ids))
            ->addSelect('orders.shift_ulid')
            ->selectRaw('COALESCE(SUM(orders.needs_review), 0) AS needs_review_count')
            ->groupBy('orders.shift_ulid')
            ->get()
            ->keyBy('shift_ulid');

        $payments = SalesFigures::paymentsByMethod($this->ofShifts(SalesFigures::sales(), $ids))
            ->addSelect('orders.shift_ulid')
            ->groupBy('orders.shift_ulid')
            ->get()
            ->groupBy('shift_ulid');

        $cashiers = $this->ofShifts(SalesFigures::sales(), $ids)
            ->join('users', 'users.id', '=', 'orders.user_id')
            ->groupBy('orders.shift_ulid', 'orders.user_id', 'users.name')
            ->select(['orders.shift_ulid', 'orders.user_id', 'users.name'])
            ->selectRaw(SalesFigures::ORDERS_COUNT.' AS orders_count')
            ->selectRaw(SalesFigures::NET_SALES.' AS net_sales_cents')
            ->orderByDesc('net_sales_cents')
            ->orderBy('users.name')
            ->orderBy('orders.user_id')
            ->get()
            ->groupBy('shift_ulid');

        $cash = DB::table('cash_movements')
            ->whereIn('shift_ulid', $ulids)
            ->groupBy('shift_ulid', 'type')
            ->select(['shift_ulid', 'type'])
            ->selectRaw('SUM(amount_cents) AS amount_cents')
            ->get()
            ->groupBy('shift_ulid');

        $voids = SalesFigures::selectVoids($this->ofShifts(SalesFigures::voidedOrders(), $ids))
            ->addSelect('orders.shift_ulid')
            ->groupBy('orders.shift_ulid')
            ->get()
            ->keyBy('shift_ulid');

        $refunds = SalesFigures::selectRefunds($this->refundsOfShifts($ids))
            ->addSelect('refunds.shift_ulid')
            ->groupBy('refunds.shift_ulid')
            ->get()
            ->keyBy('shift_ulid');

        $refundPayments = $this->refundsOfShifts($ids)
            ->join('refund_payments', 'refund_payments.refund_id', '=', 'refunds.id')
            ->groupBy('refunds.shift_ulid', 'refund_payments.method')
            ->select(['refunds.shift_ulid', 'refund_payments.method'])
            ->selectRaw(SalesFigures::REFUND_PAYMENT_AMOUNT.' AS amount_cents')
            ->get()
            ->groupBy('shift_ulid');

        foreach ($shifts as $shift) {
            $shift->setComputedReport($this->report(
                $shift,
                $totals->get($shift->ulid),
                $payments->get($shift->ulid, collect()),
                $cashiers->get($shift->ulid, collect()),
                $cash->get($shift->ulid, collect()),
                $voids->get($shift->ulid),
                $refunds->get($shift->ulid),
                $refundPayments->get($shift->ulid, collect()),
            ));
        }
    }

    /**
     * @param  Collection<int, object>  $payments
     * @param  Collection<int, object>  $cashiers
     * @param  Collection<int, object>  $cash
     * @param  Collection<int, object>  $refundPayments
     * @return array<string, mixed>
     */
    private function report(
        Shift $shift,
        ?object $totalsRow,
        Collection $payments,
        Collection $cashiers,
        Collection $cash,
        ?object $voidsRow,
        ?object $refundsRow,
        Collection $refundPayments,
    ): array {
        $totals = SalesFigures::totalsFrom($totalsRow);
        $byPaymentMethod = SalesFigures::paymentMethodList($payments);
        $refundsByMethod = SalesFigures::refundMethodList($refundPayments);
        $cashByType = $cash->keyBy('type');

        $cashSales = collect($byPaymentMethod)->firstWhere('method', Payment::METHOD_CASH)['amount_cents'];
        $cashRefunds = collect($refundsByMethod)->firstWhere('method', Payment::METHOD_CASH)['amount_cents'];
        $cashIn = (int) ($cashByType->get(CashMovement::TYPE_IN)?->amount_cents ?? 0);
        $cashOut = (int) ($cashByType->get(CashMovement::TYPE_OUT)?->amount_cents ?? 0);
        $expected = $shift->opening_float_cents + $cashSales + $cashIn - $cashOut - $cashRefunds;
        $refundsCents = (int) ($refundsRow->refunds_cents ?? 0);

        return [
            'orders_count' => $totals['orders_count'],
            'items_sold' => $totals['items_sold'],
            'gross_sales_cents' => $totals['gross_sales_cents'],
            'discounts_cents' => $totals['discounts_cents'],
            'net_sales_cents' => $totals['net_sales_cents'],
            'vatable_sales_cents' => $totals['vatable_sales_cents'],
            'vat_amount_cents' => $totals['vat_amount_cents'],
            'vat_exempt_sales_cents' => $totals['vat_exempt_sales_cents'],
            // SC/PWD: the shift's sales with SC/PWD, Σ R and Σ S (part of `discounts_cents`).
            'sc_pwd_orders_count' => $totals['sc_pwd_orders_count'],
            'sc_pwd_vat_relief_cents' => $totals['sc_pwd_vat_relief_cents'],
            'sc_pwd_discount_cents' => $totals['sc_pwd_discount_cents'],
            'by_payment_method' => $byPaymentMethod,
            'voids_count' => (int) ($voidsRow->voids_count ?? 0),
            'voids_cents' => (int) ($voidsRow->voids_cents ?? 0),
            'refunds_count' => (int) ($refundsRow->refunds_count ?? 0),
            'refunds_cents' => $refundsCents,
            'refunds_by_method' => $refundsByMethod,
            'net_after_refunds_cents' => $totals['net_sales_cents'] - $refundsCents,
            'cash_in_cents' => $cashIn,
            'cash_out_cents' => $cashOut,
            'expected_cash_cents' => $expected,
            'variance_cents' => $shift->counted_cash_cents === null ? null : $shift->counted_cash_cents - $expected,
            'by_cashier' => $cashiers->map(fn (object $row) => [
                'user_id' => (int) $row->user_id,
                'name' => $row->name,
                'orders_count' => (int) $row->orders_count,
                'net_sales_cents' => (int) $row->net_sales_cents,
            ])->values()->all(),
            'needs_review_count' => (int) ($totalsRow->needs_review_count ?? 0),
        ];
    }

    /**
     * The given orders (sales or voided) of these shifts: the orders of each shift's branch
     * that carry its ULID (joined on both, so a ULID never pulls in another branch's sales).
     *
     * @param  list<int>  $shiftIds
     */
    private function ofShifts(Builder $orders, array $shiftIds): Builder
    {
        return $orders
            ->join('shifts', function (JoinClause $join) {
                $join->on('shifts.ulid', '=', 'orders.shift_ulid')
                    ->on('shifts.branch_id', '=', 'orders.branch_id');
            })
            ->whereIn('shifts.id', $shiftIds);
    }

    /**
     * The refunds made in these shifts (of each shift's branch, carrying its ULID).
     *
     * @param  list<int>  $shiftIds
     */
    private function refundsOfShifts(array $shiftIds): Builder
    {
        return DB::table('refunds')
            ->join('shifts', function (JoinClause $join) {
                $join->on('shifts.ulid', '=', 'refunds.shift_ulid')
                    ->on('shifts.branch_id', '=', 'refunds.branch_id');
            })
            ->whereIn('shifts.id', $shiftIds);
    }
}
