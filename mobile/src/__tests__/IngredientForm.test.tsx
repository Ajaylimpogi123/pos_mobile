/**
 * Ingredient admin (docs/api-contract.md → Ingredients, Recipes & Purchasing
 * §D, §L): the form's validation, the units editor (`1 <name> = [factor]
 * <base unit>`, the reserved-code check, duplicates, factors), the create
 * body, 422s under a unit row, and the base unit locked once in use.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import IngredientRoute from '@/app/(app)/(admin)/ingredients/[id]';
import NewIngredientRoute from '@/app/(app)/(admin)/ingredients/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, renderWithQuery, routeFetch, type FetchCall, type Route } from '@/test-utils/catalog';
import { makeIngredient, UNIT_CATALOG } from '@/test-utils/purchasing';

const FUTURE = '2099-09-25T01:30:00Z';
const ADMIN = '/api/v1/admin/ingredients';
const unitsRoute: Route = { method: 'GET', path: '/api/v1/units', reply: () => mockResponse(200, { data: UNIT_CATALOG }) };

function posts(calls: FetchCall[], method = 'POST', path = ADMIN): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
});

async function renderNew() {
  const result = await renderWithQuery(<NewIngredientRoute />);
  await screen.findByTestId('ingredient-form-screen');
  return result;
}

describe('new ingredient', () => {
  it('checks the name and every unit row before sending anything', async () => {
    const { calls } = routeFetch([unitsRoute]);
    await renderNew();
    await waitFor(() => expect(calls.some((call) => call.path === '/api/v1/units')).toBe(true));

    await fireEvent.press(screen.getByTestId('units-editor-add'));
    await fireEvent.press(screen.getByTestId('units-editor-add'));
    await fireEvent.changeText(screen.getByTestId('unit-row-0-name'), 'kg');
    // The reserved code shows inline while typing (§L).
    expect(await screen.findByTestId('unit-row-0-name-error')).toHaveTextContent('"kg" is already a standard unit.');
    await fireEvent.changeText(screen.getByTestId('unit-row-0-name'), 'sack');
    await fireEvent.changeText(screen.getByTestId('unit-row-1-name'), 'SACK');
    await fireEvent.changeText(screen.getByTestId('unit-row-1-factor'), '0');

    await fireEvent.press(screen.getByTestId('ingredient-save'));

    expect(screen.getByTestId('ingredient-name-error')).toHaveTextContent('Enter a name.');
    expect(screen.getByTestId('unit-row-0-factor-error')).toHaveTextContent('Enter how many g one unit holds, e.g. 25000.');
    expect(screen.getByTestId('unit-row-1-name-error')).toHaveTextContent('This ingredient already has a unit with this name.');
    expect(screen.getByTestId('unit-row-1-factor-error')).toBeOnTheScreen();
    expect(posts(calls)).toHaveLength(0);
  });

  it('a unit reusing a code of another dimension is fine (cup = 120 g), and the row shows 1 cup = 120 g', async () => {
    const created = makeIngredient({ units: [{ id: 12, name: 'cup', factor: '120' }], last_movement_at: null });
    const { calls } = routeFetch([unitsRoute, { method: 'POST', path: ADMIN, reply: () => mockResponse(201, { data: created }) }]);
    await renderNew();

    await fireEvent.changeText(screen.getByTestId('ingredient-name'), '  Flour ');
    await fireEvent.press(screen.getByTestId('units-editor-add'));
    await fireEvent.changeText(screen.getByTestId('unit-row-0-name'), 'cup');
    await fireEvent.changeText(screen.getByTestId('unit-row-0-factor'), '120.00');
    expect(screen.getByTestId('unit-row-0-hint')).toHaveTextContent('1 cup = 120 g');

    await fireEvent.press(screen.getByTestId('ingredient-save'));

    await waitFor(() => expect(posts(calls)).toHaveLength(1));
    expect(jsonBody(posts(calls)[0] as FetchCall)).toEqual({ name: 'Flour', base_unit: 'g', is_active: true, units: [{ name: 'cup', factor: '120' }] });
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('a 422 on a unit row lands under that row', async () => {
    routeFetch([
      unitsRoute,
      {
        method: 'POST',
        path: ADMIN,
        reply: () => mockResponse(422, { message: 'Invalid.', errors: { 'units.0.name': ['The units.0.name has already been taken.'] } }),
      },
    ]);
    await renderNew();
    await fireEvent.changeText(screen.getByTestId('ingredient-name'), 'Milk');
    await fireEvent.press(screen.getByTestId('ingredient-base-mL'));
    await fireEvent.press(screen.getByTestId('units-editor-add'));
    await fireEvent.changeText(screen.getByTestId('unit-row-0-name'), 'jug');
    await fireEvent.changeText(screen.getByTestId('unit-row-0-factor'), '4000');
    await fireEvent.press(screen.getByTestId('ingredient-save'));

    expect(await screen.findByTestId('unit-row-0-name-error')).toHaveTextContent('The units.0.name has already been taken.');
    expect(screen.queryByTestId('form-banner')).toBeNull();
  });
});

describe('edit ingredient: the base unit', () => {
  it('is locked once the ingredient has movements', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '5' });
    routeFetch([unitsRoute, { method: 'GET', path: `${ADMIN}/5`, reply: () => mockResponse(200, { data: makeIngredient() }) }]);
    await renderWithQuery(<IngredientRoute />);
    await screen.findByTestId('ingredient-form-screen');

    expect(screen.getByTestId('ingredient-base-mL')).toBeDisabled();
    expect(screen.getByTestId('ingredient-base-help')).toHaveTextContent("The base unit can't change once the ingredient is in use.");
    // The saved units are in the editor.
    expect(screen.getByTestId('unit-row-0-name').props.value).toBe('sack');
  });

  it('follows base_unit_locked from the server, not the movements (Q-025)', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '5' });
    routeFetch([unitsRoute, { method: 'GET', path: `${ADMIN}/5`, reply: () => mockResponse(200, { data: makeIngredient({ base_unit_locked: false }) }) }]);
    await renderWithQuery(<IngredientRoute />);
    await screen.findByTestId('ingredient-form-screen');
    expect(screen.getByTestId('ingredient-base-mL')).not.toBeDisabled();
    expect(screen.getByTestId('ingredient-base-help')).not.toHaveTextContent(/can't change/);
  });

  it('locks after the 409 when the server says it is in use, and keeps the saved base unit', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '5' });
    const fresh = makeIngredient({ base_unit_locked: false, last_movement_at: null, units: [] });
    const { calls } = routeFetch([
      unitsRoute,
      { method: 'GET', path: `${ADMIN}/5`, reply: () => mockResponse(200, { data: fresh }) },
      { method: 'PATCH', path: `${ADMIN}/5`, reply: () => mockResponse(409, { message: "The base unit can't change once the ingredient is in use." }) },
    ]);
    await renderWithQuery(<IngredientRoute />);
    await screen.findByTestId('ingredient-form-screen');

    await fireEvent.press(screen.getByTestId('ingredient-base-pc'));
    await fireEvent.press(screen.getByTestId('ingredient-save'));

    await waitFor(() => expect(posts(calls, 'PATCH', `${ADMIN}/5`)).toHaveLength(1));
    expect(jsonBody(posts(calls, 'PATCH', `${ADMIN}/5`)[0] as FetchCall)).toEqual({ base_unit: 'pc' });
    expect(await screen.findByTestId('form-banner')).toHaveTextContent(/The base unit can't change once the ingredient is in use./);
    expect(screen.getByTestId('ingredient-base-pc')).toBeDisabled();
    expect(screen.getByTestId('ingredient-base-g').props.accessibilityState).toMatchObject({ selected: true });
  });
});
