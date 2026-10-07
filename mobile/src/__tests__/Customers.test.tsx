import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import CustomerRoute from '@/app/(app)/(pos)/customers/[id]';
import CustomersIndexRoute from '@/app/(app)/(pos)/customers/index';
import NewCustomerRoute from '@/app/(app)/(pos)/customers/new';
import { useSessionStore } from '@/stores/session';
import { cashierUser, mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, page, renderWithQuery, routeFetch, type Route } from '@/test-utils/catalog';
import { makeCustomer, managerWithCustomers, viewerUser } from '@/test-utils/staff';

const FUTURE = '2026-09-25T01:30:00Z';
const maria = makeCustomer();
const ana = makeCustomer({ id: 14, first_name: 'Ana', last_name: 'Reyes', full_name: 'Ana Reyes', contact: null, email: null, notes: null });

const listRoute: Route = {
  method: 'GET',
  path: '/api/v1/customers',
  reply: () => mockResponse(200, page([maria, ana], null, '/api/v1/customers')),
};

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, FUTURE);
  (router.push as jest.Mock).mockClear();
  (router.back as jest.Mock).mockClear();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '12' });
});

describe('Customers list', () => {
  it('renders cards: full name, contact, email and a truncated notes preview', async () => {
    routeFetch([listRoute]);

    await renderWithQuery(<CustomersIndexRoute />);

    const card = await screen.findByTestId('customer-card-12');
    expect(card).toHaveTextContent(/Maria Santos/);
    expect(screen.getByTestId('customer-card-12-contact')).toHaveTextContent('0917 123 4567');
    expect(screen.getByTestId('customer-card-12-email')).toHaveTextContent('maria@example.com');
    const notes = screen.getByTestId('customer-card-12-notes');
    expect(notes).toHaveTextContent('Prefers less rice');
    expect(notes.props.numberOfLines).toBe(2);
    expect(screen.getByTestId('customer-card-14')).toHaveTextContent(/No contact details/);
  });

  it('sends the debounced search', async () => {
    const { calls } = routeFetch([listRoute]);

    await renderWithQuery(<CustomersIndexRoute />);
    await screen.findByTestId('customer-card-12');
    expect(screen.getByTestId('customer-search').props.placeholder).toBe('Name, phone or email');
    expect(calls[0].query.has('search')).toBe(false);

    await fireEvent.changeText(screen.getByTestId('customer-search'), ' 0917 123 ');
    await waitFor(() => {
      const last = calls.filter((call) => call.path === '/api/v1/customers').at(-1);
      expect(last?.query.get('search')).toBe('0917 123');
      expect(last?.query.get('per_page')).toBe('25');
    });
  });

  it('shows "New customer" with sale.create', async () => {
    routeFetch([listRoute]);

    await renderWithQuery(<CustomersIndexRoute />);
    await fireEvent.press(await screen.findByTestId('customers-new'));

    expect(router.push).toHaveBeenCalledWith('/customers/new');
  });

  it('hides "New customer" without sale.create', async () => {
    useSessionStore.getState().setSignedIn(viewerUser, FUTURE);
    routeFetch([listRoute]);

    await renderWithQuery(<CustomersIndexRoute />);
    await screen.findByTestId('customer-card-12');

    expect(screen.queryByTestId('customers-new')).toBeNull();
  });

  it('shows the empty and error states', async () => {
    let fail = false;
    routeFetch([
      {
        method: 'GET',
        path: '/api/v1/customers',
        reply: () => (fail ? mockResponse(500, { message: 'Server Error.' }) : mockResponse(200, page([], null, '/api/v1/customers'))),
      },
    ]);

    await renderWithQuery(<CustomersIndexRoute />);
    expect(await screen.findByTestId('customers-grid-empty')).toHaveTextContent(/No customers yet/);

    fail = true;
    await fireEvent(screen.getByTestId('customer-search'), 'changeText', 'zzz');
    expect(await screen.findByTestId('customers-grid-error')).toHaveTextContent(/Server Error\./);
  });
});

describe('Customer form', () => {
  it('creates a customer, showing 422s under the fields first', async () => {
    let attempt = 0;
    const { calls } = routeFetch([
      {
        method: 'POST',
        path: '/api/v1/customers',
        reply: () => {
          attempt += 1;
          return attempt === 1
            ? mockResponse(422, {
                message: 'The contact field format is invalid. (and 1 more error)',
                errors: { contact: ['The contact field format is invalid.'], email: ['The email field must be a valid email address.'] },
              })
            : mockResponse(201, { data: makeCustomer({ id: 20, notes: null }) });
        },
      },
    ]);

    await renderWithQuery(<NewCustomerRoute />);
    expect(screen.getByTestId('customer-contact').props.keyboardType).toBe('phone-pad');
    expect(screen.getByTestId('customer-email').props.keyboardType).toBe('email-address');
    expect(screen.getByTestId('customer-email').props.autoCapitalize).toBe('none');
    expect(screen.getByTestId('customer-notes').props.multiline).toBe(true);

    await fireEvent.changeText(screen.getByTestId('customer-first-name'), ' Maria ');
    await fireEvent.changeText(screen.getByTestId('customer-last-name'), 'Santos');
    await fireEvent.changeText(screen.getByTestId('customer-contact'), '0917 123 4567');
    await fireEvent.changeText(screen.getByTestId('customer-email'), 'maria@example.com');
    await fireEvent.press(screen.getByTestId('customer-save'));

    expect(await screen.findByTestId('customer-contact-error')).toHaveTextContent('The contact field format is invalid.');
    expect(screen.getByTestId('customer-email-error')).toHaveTextContent('The email field must be a valid email address.');
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('customer-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(jsonBody(calls.at(-1)!)).toEqual({
      first_name: 'Maria',
      last_name: 'Santos',
      contact: '0917 123 4567',
      email: 'maria@example.com',
      notes: null,
    });
  });

  it('requires a first name and checks the contact characters locally', async () => {
    const { calls } = routeFetch([]);

    await renderWithQuery(<NewCustomerRoute />);
    await fireEvent.changeText(screen.getByTestId('customer-contact'), '0917#123');
    await fireEvent.press(screen.getByTestId('customer-save'));

    expect(screen.getByTestId('customer-first-name-error')).toHaveTextContent('Enter a first name.');
    expect(screen.getByTestId('customer-contact-error')).toHaveTextContent('Use only digits, spaces and + ( ) -.');
    expect(calls).toHaveLength(0);
  });

  it('edits a customer with PATCH (changed fields only) and shows 422s under the fields', async () => {
    let attempt = 0;
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/customers/12', reply: () => mockResponse(200, { data: maria }) },
      {
        method: 'PATCH',
        path: '/api/v1/customers/12',
        reply: () => {
          attempt += 1;
          return attempt === 1
            ? mockResponse(422, { message: 'The notes field must not be greater than 500 characters.', errors: { notes: ['The notes field must not be greater than 500 characters.'] } })
            : mockResponse(200, { data: { ...maria, notes: 'No onions' } });
        },
      },
    ]);

    await renderWithQuery(<CustomerRoute />);
    await fireEvent.changeText(await screen.findByTestId('customer-notes'), 'No onions');
    await fireEvent.press(screen.getByTestId('customer-save'));

    expect(await screen.findByTestId('customer-notes-error')).toHaveTextContent('The notes field must not be greater than 500 characters.');
    expect(jsonBody(calls.find((call) => call.method === 'PATCH')!)).toEqual({ notes: 'No onions' });

    await fireEvent.press(screen.getByTestId('customer-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('hides Delete without customer.manage (a cashier)', async () => {
    routeFetch([{ method: 'GET', path: '/api/v1/customers/12', reply: () => mockResponse(200, { data: maria }) }]);

    await renderWithQuery(<CustomerRoute />);
    await screen.findByTestId('customer-save');

    expect(screen.queryByTestId('customer-delete')).toBeNull();
  });

  it('deletes with customer.manage after a confirm', async () => {
    useSessionStore.getState().setSignedIn(managerWithCustomers, FUTURE);
    const { calls } = routeFetch([
      { method: 'GET', path: '/api/v1/customers/12', reply: () => mockResponse(200, { data: maria }) },
      { method: 'DELETE', path: '/api/v1/customers/12', reply: () => mockResponse(204) },
    ]);

    await renderWithQuery(<CustomerRoute />);
    await fireEvent.press(await screen.findByTestId('customer-delete'));
    expect(screen.getByTestId('delete-customer-dialog')).toHaveTextContent(/Maria Santos/);
    await fireEvent.press(screen.getByTestId('delete-customer-dialog-confirm'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/v1/customers/12']);
  });

  it('shows the record read-only without sale.create', async () => {
    useSessionStore.getState().setSignedIn(viewerUser, FUTURE);
    routeFetch([{ method: 'GET', path: '/api/v1/customers/12', reply: () => mockResponse(200, { data: maria }) }]);

    await renderWithQuery(<CustomerRoute />);

    expect(await screen.findByTestId('customer-readonly')).toBeOnTheScreen();
    expect(screen.getByTestId('customer-first-name').props.editable).toBe(false);
    expect(screen.queryByTestId('customer-save')).toBeNull();
    expect(screen.queryByTestId('customer-delete')).toBeNull();
  });
});
