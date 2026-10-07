/**
 * Suppliers (docs/api-contract.md → Ingredients, Recipes & Purchasing §C):
 * the list (search, active filter), the form's validation and create body,
 * partial PATCH, the delete 409, and read-only without `supplier.manage`.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import SupplierRoute from '@/app/(app)/(admin)/purchasing/suppliers/[id]';
import SuppliersIndexRoute from '@/app/(app)/(admin)/purchasing/suppliers/index';
import NewSupplierRoute from '@/app/(app)/(admin)/purchasing/suppliers/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';
import { makeSupplier, requesterCashier } from '@/test-utils/purchasing';

const FUTURE = '2099-09-25T01:30:00Z';
const SUPPLIERS = '/api/v1/admin/suppliers';

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
});

it('the list searches and filters by active', async () => {
  const { calls } = routeFetch([{ method: 'GET', path: SUPPLIERS, reply: () => mockResponse(200, page([makeSupplier()], null, SUPPLIERS)) }]);
  await renderWithQuery(<SuppliersIndexRoute />);
  expect(await screen.findByTestId('supplier-card-4-person')).toHaveTextContent('Ana Reyes');
  await fireEvent.press(screen.getByTestId('suppliers-segment-inactive'));
  await waitFor(() => expect(calls.at(-1)?.query.get('is_active')).toBe('0'));
  await fireEvent.changeText(screen.getByTestId('supplier-search'), 'Golden');
  await waitFor(() => expect(calls.at(-1)?.query.get('search')).toBe('Golden'));
});

it('validates, then creates with trimmed fields and nulls for blanks', async () => {
  const { calls } = routeFetch([{ method: 'POST', path: SUPPLIERS, reply: () => mockResponse(201, { data: makeSupplier() }) }]);
  await renderWithQuery(<NewSupplierRoute />);
  await fireEvent.changeText(screen.getByTestId('supplier-email'), 'not-an-email');
  await fireEvent.changeText(screen.getByTestId('supplier-contact-number'), '0'.repeat(31));
  await fireEvent.press(screen.getByTestId('supplier-save'));
  expect(screen.getByTestId('supplier-name-error')).toHaveTextContent('Enter the supplier name.');
  expect(screen.getByTestId('supplier-email-error')).toHaveTextContent('Enter a valid email address.');
  expect(screen.getByTestId('supplier-contact-number-error')).toHaveTextContent('Use 30 characters or fewer.');
  expect(callsTo(calls, 'POST', SUPPLIERS)).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('supplier-name'), ' Golden Mills Trading ');
  await fireEvent.changeText(screen.getByTestId('supplier-email'), '');
  await fireEvent.changeText(screen.getByTestId('supplier-contact-number'), '0917 123 4567');
  await fireEvent.press(screen.getByTestId('supplier-save'));
  await waitFor(() => expect(callsTo(calls, 'POST', SUPPLIERS)).toHaveLength(1));
  expect(jsonBody(callsTo(calls, 'POST', SUPPLIERS)[0] as FetchCall)).toEqual({
    name: 'Golden Mills Trading',
    contact_person: null,
    contact_number: '0917 123 4567',
    email: null,
    address: null,
    is_active: true,
  });
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});

it('edits with a partial PATCH, and shows the delete 409 in the banner', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '4' });
  const { calls } = routeFetch([
    { method: 'GET', path: `${SUPPLIERS}/4`, reply: () => mockResponse(200, { data: makeSupplier() }) },
    { method: 'PATCH', path: `${SUPPLIERS}/4`, reply: () => mockResponse(200, { data: makeSupplier({ is_active: false }) }) },
    { method: 'DELETE', path: `${SUPPLIERS}/4`, reply: () => mockResponse(409, { message: 'This supplier is on purchase orders. Deactivate it instead.' }) },
  ]);
  await renderWithQuery(<SupplierRoute />);
  await screen.findByTestId('supplier-form-screen');

  await fireEvent.press(screen.getByTestId('supplier-delete'));
  await fireEvent.press(screen.getByTestId('delete-supplier-dialog-confirm'));
  expect(await screen.findByTestId('form-banner')).toHaveTextContent(/Deactivate it instead\./);

  await fireEvent(screen.getByTestId('supplier-active'), 'valueChange', false);
  await fireEvent.press(screen.getByTestId('supplier-save'));
  await waitFor(() => expect(callsTo(calls, 'PATCH', `${SUPPLIERS}/4`)).toHaveLength(1));
  expect(jsonBody(callsTo(calls, 'PATCH', `${SUPPLIERS}/4`)[0] as FetchCall)).toEqual({ is_active: false });
});

it('is read-only without supplier.manage', async () => {
  useSessionStore.getState().setSignedIn(requesterCashier, FUTURE);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '4' });
  routeFetch([{ method: 'GET', path: `${SUPPLIERS}/4`, reply: () => mockResponse(200, { data: makeSupplier() }) }]);
  await renderWithQuery(<SupplierRoute />);
  expect(await screen.findByTestId('supplier-readonly')).toBeOnTheScreen();
  expect(screen.queryByTestId('supplier-save')).toBeNull();
  expect(screen.queryByTestId('supplier-delete')).toBeNull();
});
