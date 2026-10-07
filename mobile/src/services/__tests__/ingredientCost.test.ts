/**
 * §D1 Set cost: POST /api/v1/admin/ingredients/{id}/cost through the shared
 * client (the body, the Idempotency-Key, the `Ingredient` envelope, a 422).
 */
import { isApiValidationError } from '@/services/api';
import { setIngredientCost } from '@/services/ingredients';
import { useSessionStore } from '@/stores/session';
import { cashierUser, installFetchMock, mockResponse, secureStoreMock } from '@/test-utils';
import { makeIngredient } from '@/test-utils/purchasing';

const ORIGIN = 'http://192.168.1.50:8000';
const ULID = '01K6COST000000000000000000';

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

describe('setIngredientCost', () => {
  it('posts the ulid, cost_cents, unit and reason with the ulid as Idempotency-Key, and returns the Ingredient', async () => {
    const fetchMock = installFetchMock();
    const updated = makeIngredient({ avg_cost: '5.000000', stock_value_cents: 150000 });
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: updated }));

    const result = await setIngredientCost(5, { ulid: ULID, cost_cents: 125000, unit: 'sack', reason: 'Supplier price list' });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${ORIGIN}/api/v1/admin/ingredients/5/cost`);
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(ULID);
    expect(init.headers.Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body ?? '')).toEqual({ ulid: ULID, cost_cents: 125000, unit: 'sack', reason: 'Supplier price list' });
    expect(result).toEqual(updated);
  });

  it('leaves out an empty reason (optional)', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(mockResponse(200, { data: makeIngredient() }));
    await setIngredientCost(5, { ulid: ULID, cost_cents: 48, unit: 'g' });
    expect(JSON.parse(lastCall(fetchMock).init.body ?? '')).toEqual({ ulid: ULID, cost_cents: 48, unit: 'g' });
  });

  it('a 422 throws a validation error with the field messages', async () => {
    const fetchMock = installFetchMock();
    fetchMock.mockResolvedValueOnce(
      mockResponse(422, { message: 'The cost is too small for this unit.', errors: { cost_cents: ['The cost is too small for this unit.'] } }),
    );
    const failure = await setIngredientCost(5, { ulid: ULID, cost_cents: 1, unit: 'sack' }).catch((error: unknown) => error);
    expect(isApiValidationError(failure)).toBe(true);
    if (isApiValidationError(failure)) expect(failure.errors.cost_cents).toEqual(['The cost is too small for this unit.']);
  });
});
