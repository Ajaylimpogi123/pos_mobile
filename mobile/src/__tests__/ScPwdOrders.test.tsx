/**
 * Senior Citizen / PWD Discount after the sale (docs/api-contract.md →
 * Senior Citizen / PWD Discount → Response changes, Reports, Device rules →
 * Orders detail): the SC/PWD block and line chips on the order detail, the
 * `has_sc_pwd` badge on order cards, and the SC/PWD figures on the Shifts
 * report, the Reports totals and the dashboard sales card.
 */
import { screen, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import OrderRoute from '@/app/(app)/(pos)/orders/[ulid]';
import OrdersIndexRoute from '@/app/(app)/(pos)/orders/index';
import { SalesCard } from '@/components/dashboard/SalesCard';
import { ReportTotalsCard } from '@/components/reports/ReportParts';
import { ShiftReportView } from '@/components/shifts/ShiftReportView';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { page, renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { makeOrderSummary, makeSales, makeScPwdOrder, makeSharedMealOrder } from '@/test-utils/sale';
import { makeSalesReport, makeShiftReport } from '@/test-utils/shifts';

const FUTURE = '2099-09-25T01:30:00Z';
const NOW = Date.parse('2026-09-25T02:00:00Z');
const ORDERS = '/api/v1/orders';

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('order detail', () => {
  it('items mode, VAT exempt: the SC/PWD block (mode, person, amounts), its totals rows and the line chips', async () => {
    const order = makeScPwdOrder(true);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: order.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${order.ulid}`, reply: () => mockResponse(200, { data: order }) }]);
    await renderWithQuery(<OrderRoute />);

    const block = await screen.findByTestId('order-sc-pwd');
    expect(within(block).getByTestId('order-sc-pwd-mode')).toHaveTextContent('Their items');
    expect(within(block).getByTestId('order-sc-pwd-person-0')).toHaveTextContent('ID OSCA-12345');
    expect(within(block).getByText('Senior citizen')).toBeOnTheScreen();
    expect(within(block).getByTestId('order-sc-pwd-vat-status')).toHaveTextContent(/VAT exempt/);
    expect(within(block).getByTestId('order-block-sc-pwd-vat-amount')).toHaveTextContent('−₱31.61');
    expect(within(block).getByTestId('order-block-sc-pwd-discount-amount')).toHaveTextContent('−₱52.68');

    expect(screen.getByTestId('order-sc-pwd-vat-amount')).toHaveTextContent('−₱31.61');
    expect(screen.getByTestId('order-sc-pwd-discount-amount')).toHaveTextContent('−₱52.68');
    expect(screen.getByTestId('order-total-amount')).toHaveTextContent('₱460.71');
    // SHOW_VAT_BREAKDOWN is off: the VAT exempted deduction stays, the VAT breakdown is hidden.
    expect(screen.queryByTestId('order-vat-exempt')).toBeNull();
    expect(screen.getByTestId('order-item-201-sc-pwd')).toBeOnTheScreen();
    expect(screen.getByTestId('order-item-202-sc-pwd')).toBeOnTheScreen();
    expect(screen.queryByTestId('order-item-203-sc-pwd')).toBeNull();
    expect(screen.queryByTestId('order-line-discounts')).toBeNull();
  });

  it('not VAT exempt: no "VAT exempted" row; a shared meal shows its diners', async () => {
    const taxable = makeScPwdOrder(false);
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: taxable.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${taxable.ulid}`, reply: () => mockResponse(200, { data: taxable }) }]);
    const view = await renderWithQuery(<OrderRoute />);
    await screen.findByTestId('order-sc-pwd');
    expect(screen.queryByTestId('order-sc-pwd-vat')).toBeNull();
    expect(screen.queryByTestId('order-block-sc-pwd-vat')).toBeNull();
    expect(screen.getByTestId('order-sc-pwd-discount-amount')).toHaveTextContent('−₱59.00');
    expect(screen.getByTestId('order-sc-pwd-vat-status')).toHaveTextContent(/VAT-able/);
    await view.unmount();

    const shared = makeSharedMealOrder();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: shared.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${shared.ulid}`, reply: () => mockResponse(200, { data: shared }) }]);
    await renderWithQuery(<OrderRoute />);
    expect(await screen.findByTestId('order-sc-pwd-mode')).toHaveTextContent('Shared by 4 diners, 1 SC/PWD');
    expect(screen.getByTestId('order-item-303-sc-pwd')).toBeOnTheScreen();
  });

  it('an order without SC/PWD has no block', async () => {
    const plain = makeScPwdOrder(true, { sc_pwd: null });
    (useLocalSearchParams as jest.Mock).mockReturnValue({ ulid: plain.ulid });
    routeFetch([{ method: 'GET', path: `${ORDERS}/${plain.ulid}`, reply: () => mockResponse(200, { data: plain }) }]);
    await renderWithQuery(<OrderRoute />);
    await screen.findByTestId('order-receipt');
    expect(screen.queryByTestId('order-sc-pwd')).toBeNull();
    expect(screen.queryByTestId('order-sc-pwd-discount')).toBeNull();
  });
});

describe('order cards', () => {
  it('show an SC/PWD badge when has_sc_pwd', async () => {
    const withScPwd = makeOrderSummary({ has_sc_pwd: true });
    const without = makeOrderSummary({ ulid: '01K62Y0000000000000000000A', invoice_no: 'INV-MAIN-00000041', has_sc_pwd: false });
    routeFetch([{ method: 'GET', path: ORDERS, reply: () => mockResponse(200, page([withScPwd, without], null, ORDERS)) }]);
    await renderWithQuery(<OrdersIndexRoute />);
    expect(await screen.findByTestId(`order-card-${withScPwd.ulid}-sc-pwd`)).toHaveTextContent(/SC\/PWD/);
    expect(screen.queryByTestId(`order-card-${without.ulid}-sc-pwd`)).toBeNull();
  });
});

describe('reports', () => {
  it('Shifts: the SC/PWD discount (with its sales count) and the VAT exempted when not 0', async () => {
    const report = makeShiftReport({ sc_pwd_orders_count: 2, sc_pwd_vat_relief_cents: 3161, sc_pwd_discount_cents: 11168 });
    await renderWithQuery(<ShiftReportView report={report} openingFloatCents={200000} countedCashCents={null} testID="report" />);
    expect(screen.getByTestId('report-sc-pwd')).toHaveTextContent(/2 SC\/PWD sales/);
    expect(screen.getByTestId('report-sc-pwd-amount')).toHaveTextContent('−₱111.68');
    expect(screen.getByTestId('report-sc-pwd-vat-amount')).toHaveTextContent('−₱31.61');
  });

  it('Shifts: with none, ₱0.00 and no VAT exempted row', async () => {
    await renderWithQuery(<ShiftReportView report={makeShiftReport()} openingFloatCents={0} countedCashCents={null} testID="report" />);
    expect(screen.getByTestId('report-sc-pwd-amount')).toHaveTextContent('₱0.00');
    expect(screen.queryByTestId('report-sc-pwd-vat')).toBeNull();
  });

  it('Reports totals: an SC/PWD (N) tile, and VAT exempted when not 0', async () => {
    const totals = { ...makeSalesReport().totals, sc_pwd_orders_count: 3, sc_pwd_vat_relief_cents: 5947, sc_pwd_discount_cents: 10211 };
    await renderWithQuery(<ReportTotalsCard totals={totals} />);
    expect(screen.getByText('SC/PWD (3)')).toBeOnTheScreen();
    expect(screen.getByTestId('report-total-sc-pwd')).toHaveTextContent('₱102.11');
    expect(screen.getByTestId('report-total-sc-pwd-vat')).toHaveTextContent('₱59.47');
  });

  it('Dashboard: the SC/PWD figures only once there is an SC/PWD sale today', async () => {
    const view = await renderWithQuery(<SalesCard sales={makeSales()} />);
    expect(screen.queryByTestId('sales-sc-pwd')).toBeNull();
    await view.unmount();

    await renderWithQuery(<SalesCard sales={makeSales({ sc_pwd_orders_count: 1, sc_pwd_vat_relief_cents: 3161, sc_pwd_discount_cents: 5268 })} />);
    expect(screen.getByTestId('sales-sc-pwd-value')).toHaveTextContent('₱52.68');
    expect(screen.getByText('SC/PWD (1)')).toBeOnTheScreen();
    expect(screen.getByTestId('sales-sc-pwd-vat-value')).toHaveTextContent('₱31.61');
  });
});
