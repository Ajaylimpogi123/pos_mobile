import {
  createStaff,
  deleteStaff,
  getStaff,
  listRoles,
  listStaff,
  resetPassword,
  setPin,
  updateStaff,
} from '@/services/adminStaff';
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from '@/services/customers';
import { useSessionStore } from '@/stores/session';
import { cashierUser, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';
import { page } from '@/test-utils/catalog';
import { makeCustomer, makeStaff, rolesForManager } from '@/test-utils/staff';

const ORIGIN = 'http://192.168.1.50:8000';

type FetchInit = { method: string; headers: Record<string, string>; body?: string };

function lastCall(fetchMock: jest.Mock): { url: string; init: FetchInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, FetchInit];
  return { url, init };
}

beforeEach(async () => {
  secureStoreMock().__resetSecureStore();
  await secureStoreMock().setItemAsync('pos.auth.token', 'TOKEN');
  useSessionStore.getState().setSignedIn(cashierUser, '2026-09-25T01:30:00Z');
});

describe('adminStaff service', () => {
  it('lists staff with search, role_id and is_active (as 1/0) and returns the envelope', async () => {
    const fetchMock = installFetchMock();
    const body = page([makeStaff()], 'NEXT', '/api/v1/admin/users');
    fetchMock.mockResolvedValueOnce(mockResponse(200, body));

    const result = await listStaff({ per_page: 25, cursor: 'CUR', search: 'car la', role_id: 3, is_active: false });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${ORIGIN}/api/v1/admin/users?per_page=25&cursor=CUR&search=car%20la&role_id=3&is_active=0`);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer TOKEN');
    expect(init.body).toBeUndefined();
    expect(result.meta.next_cursor).toBe('NEXT');
    expect(result.data[0].has_pin).toBe(false);
  });

  it('omits unset filters', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(200, page([], null, '/api/v1/admin/users')));

    await listStaff({ is_active: true });

    expect(lastCall(fetchMock).url).toBe(`${ORIGIN}/api/v1/admin/users?is_active=1`);
  });

  it('shows, creates, updates and deletes a staff member', async () => {
    const fetchMock = installFetchMock();
    const staff = makeStaff();

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: staff }));
    await expect(getStaff(3)).resolves.toEqual(staff);
    expect(lastCall(fetchMock)).toMatchObject({ url: `${ORIGIN}/api/v1/admin/users/3`, init: { method: 'GET' } });

    fetchMock.mockResolvedValueOnce(mockResponse(201, { data: staff }));
    const createBody = { name: 'Carla', email: 'c@pos.test', password: 'Secret1234', role_id: 3, is_active: true, pin: '0580' };
    await createStaff(createBody);
    let call = lastCall(fetchMock);
    expect(call.url).toBe(`${ORIGIN}/api/v1/admin/users`);
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.init.body!)).toEqual(createBody);

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: staff }));
    await updateStaff(3, { name: 'Carla C.' });
    call = lastCall(fetchMock);
    expect(call.url).toBe(`${ORIGIN}/api/v1/admin/users/3`);
    expect(call.init.method).toBe('PATCH');
    expect(JSON.parse(call.init.body!)).toEqual({ name: 'Carla C.' });

    fetchMock.mockResolvedValueOnce(mockResponse(204));
    await expect(deleteStaff(3)).resolves.toBeUndefined();
    expect(lastCall(fetchMock)).toMatchObject({ url: `${ORIGIN}/api/v1/admin/users/3`, init: { method: 'DELETE' } });
  });

  it('resets a password with POST …/password → 204', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(204));

    await expect(resetPassword(3, 'NewSecret99')).resolves.toBeUndefined();

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${ORIGIN}/api/v1/admin/users/3/password`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body!)).toEqual({ password: 'NewSecret99' });
  });

  it('sets a PIN as a string (leading zeros kept) and removes it with null, via PUT …/pin', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: makeStaff({ has_pin: true }) }));

    const withPin = await setPin(3, '0580');
    let call = lastCall(fetchMock);
    expect(call.url).toBe(`${ORIGIN}/api/v1/admin/users/3/pin`);
    expect(call.init.method).toBe('PUT');
    expect(call.init.body).toBe('{"pin":"0580"}');
    expect(withPin.has_pin).toBe(true);

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: makeStaff({ has_pin: false }) }));
    const withoutPin = await setPin(3, null);
    call = lastCall(fetchMock);
    expect(call.init.method).toBe('PUT');
    expect(call.init.body).toBe('{"pin":null}');
    expect(withoutPin.has_pin).toBe(false);
  });

  it('lists roles with per_page', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(200, page(rolesForManager, null, '/api/v1/admin/roles')));

    const result = await listRoles({ per_page: 100 });

    expect(lastCall(fetchMock)).toMatchObject({ url: `${ORIGIN}/api/v1/admin/roles?per_page=100`, init: { method: 'GET' } });
    expect(result.data.map((role) => role.assignable)).toEqual([false, true, true]);
  });
});

describe('customers service', () => {
  it('lists and searches customers', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(200, page([makeCustomer()], null, '/api/v1/customers')));

    const result = await listCustomers({ per_page: 25, search: '0917 123' });

    expect(lastCall(fetchMock)).toMatchObject({
      url: `${ORIGIN}/api/v1/customers?per_page=25&search=0917%20123`,
      init: { method: 'GET' },
    });
    expect(result.data[0].full_name).toBe('Maria Santos');
  });

  it('shows, creates, updates and deletes a customer', async () => {
    const fetchMock = installFetchMock();
    const customer = makeCustomer();

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: customer }));
    await expect(getCustomer(12)).resolves.toEqual(customer);
    expect(lastCall(fetchMock).url).toBe(`${ORIGIN}/api/v1/customers/12`);

    fetchMock.mockResolvedValueOnce(mockResponse(201, { data: customer }));
    const body = { first_name: 'Maria', last_name: 'Santos', contact: '0917 123 4567', email: null, notes: null };
    await createCustomer(body);
    let call = lastCall(fetchMock);
    expect(call.url).toBe(`${ORIGIN}/api/v1/customers`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(call.init.body!)).toEqual(body);

    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: customer }));
    await updateCustomer(12, { notes: null });
    call = lastCall(fetchMock);
    expect(call.init.method).toBe('PATCH');
    expect(call.url).toBe(`${ORIGIN}/api/v1/customers/12`);
    expect(JSON.parse(call.init.body!)).toEqual({ notes: null });

    fetchMock.mockResolvedValueOnce(mockResponse(204));
    await deleteCustomer(12);
    expect(lastCall(fetchMock)).toMatchObject({ url: `${ORIGIN}/api/v1/customers/12`, init: { method: 'DELETE' } });
  });
});
