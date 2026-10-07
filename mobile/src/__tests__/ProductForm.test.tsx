import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';

import EditProductScreen from '@/app/(app)/(admin)/menu/products/[id]';
import NewProductScreen from '@/app/(app)/(admin)/menu/products/new';
import { useSessionStore } from '@/stores/session';
import { mockResponse, resetWindowSize, secureStoreMock, setWindowSize, REFERENCE_SIZES } from '@/test-utils';
import {
  jsonBody,
  makeCategory,
  makeProduct,
  managerUser,
  page,
  renderWithQuery,
  routeFetch,
  type FetchCall,
  type Route,
} from '@/test-utils/catalog';

const FUTURE = '2026-09-25T01:30:00Z';

const categoriesRoute: Route = {
  method: 'GET',
  path: '/api/v1/admin/categories',
  reply: () =>
    mockResponse(
      200,
      page([makeCategory(), makeCategory({ id: 3, name: 'Meals', is_active: false })], null, '/api/v1/admin/categories'),
    ),
};

type FormDataPart = { fieldName: string; uri?: string; name?: string; type?: string; string?: string };

function formParts(call: FetchCall): FormDataPart[] {
  return (call.init.body as unknown as { getParts: () => FormDataPart[] }).getParts();
}

async function fillRequiredFields({ price = '50' }: { price?: string } = {}) {
  await fireEvent.changeText(screen.getByTestId('product-name'), '  Tapsilog ');
  await fireEvent.press(screen.getByTestId('category-picker'));
  await fireEvent.press(await screen.findByTestId('category-option-2'));
  await fireEvent.changeText(screen.getByTestId('product-price'), price);
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(managerUser, FUTURE);
  (router.back as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  (ImageManipulator.manipulate as jest.Mock).mockClear();
  jest.requireMock<{ __context: { resize: jest.Mock } }>('expo-image-manipulator').__context.resize.mockClear();
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReset();
  (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockReset();
  (ImagePicker.launchCameraAsync as jest.Mock).mockReset();
});

afterEach(() => {
  resetWindowSize();
});

describe('Product form: create', () => {
  it('converts ₱ text to integer centavos in the POST body', async () => {
    const created = makeProduct({ id: 12, name: 'Tapsilog', price_cents: 125050, cost_cents: 2250 });
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'POST', path: '/api/v1/admin/products', reply: () => mockResponse(201, { data: created }) },
    ]);

    await renderWithQuery(<NewProductScreen />);
    await fillRequiredFields({ price: '1,250.50' });
    await fireEvent.changeText(screen.getByTestId('product-cost'), '22.5');
    await fireEvent.changeText(screen.getByTestId('product-sku'), 'SIL-001');
    await fireEvent.press(screen.getByTestId('product-save'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.path).toBe('/api/v1/admin/products');
    expect((post?.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = jsonBody(post!) as Record<string, unknown>;
    expect(body).toEqual({
      category_id: 2,
      name: 'Tapsilog',
      sku: 'SIL-001',
      description: null,
      price_cents: 125050,
      cost_cents: 2250,
      is_vatable: true,
      is_available: true,
      stock_mode: 'none',
      sort_order: 0,
    });
    expect(Number.isInteger(body.price_cents)).toBe(true);
    // Sent as a JSON number, never a string or a float.
    expect(String(post?.init.body)).toContain('"price_cents":125050');
  });

  it('shows 422 errors under their fields, and keeps the banner for non-field errors', async () => {
    routeFetch([
      categoriesRoute,
      {
        method: 'POST',
        path: '/api/v1/admin/products',
        reply: () =>
          mockResponse(422, {
            message: 'The sku has already been taken. (and 1 more error)',
            errors: {
              sku: ['The sku has already been taken.'],
              price_cents: ['The price cents field must be an integer.'],
            },
          }),
      },
    ]);

    await renderWithQuery(<NewProductScreen />);
    await fillRequiredFields();
    await fireEvent.changeText(screen.getByTestId('product-sku'), 'BRK-001');
    await fireEvent.press(screen.getByTestId('product-save'));

    expect(await screen.findByTestId('product-sku-error')).toHaveTextContent('The sku has already been taken.');
    expect(screen.getByTestId('product-price-error')).toHaveTextContent('The price cents field must be an integer.');
    expect(screen.queryByTestId('form-banner')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();

    // Typing in a field clears its error.
    await fireEvent.changeText(screen.getByTestId('product-sku'), 'BRK-009');
    expect(screen.queryByTestId('product-sku-error')).toBeNull();
  });

  it('validates on the client before sending anything', async () => {
    const { calls } = routeFetch([categoriesRoute]);

    await renderWithQuery(<NewProductScreen />);
    await fireEvent.changeText(screen.getByTestId('product-price'), '50.505');
    await fireEvent.press(screen.getByTestId('product-save'));

    expect(screen.getByTestId('product-name-error')).toHaveTextContent('Enter a name.');
    expect(screen.getByTestId('category-picker-error')).toHaveTextContent('Choose a category.');
    expect(screen.getByTestId('product-price-error')).toHaveTextContent(/Enter an amount like/);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });

  it('shows a 403 in the banner', async () => {
    routeFetch([
      categoriesRoute,
      {
        method: 'POST',
        path: '/api/v1/admin/products',
        reply: () => mockResponse(403, { message: 'This action is unauthorized.' }),
      },
    ]);

    await renderWithQuery(<NewProductScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByTestId('product-save'));

    expect(await screen.findByTestId('form-banner')).toHaveTextContent(/This action is unauthorized./);
  });

  it('downscales the picked image, saves the product first, then uploads the image as multipart', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photos/big.jpg', width: 4000, height: 3000, mimeType: 'image/jpeg' }],
    });
    const created = makeProduct({ id: 12, name: 'Tapsilog' });
    const withImage = { ...created, image_url: 'http://192.168.1.7:8000/storage/products/12/x.jpg', image_path: 'products/12/x.jpg' };
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'POST', path: '/api/v1/admin/products', reply: () => mockResponse(201, { data: created }) },
      { method: 'POST', path: '/api/v1/admin/products/12/image', reply: () => mockResponse(200, { data: withImage }) },
    ]);

    await renderWithQuery(<NewProductScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByTestId('image-choose'));

    expect(await screen.findByTestId('image-pending-hint')).toBeOnTheScreen();
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///photos/big.jpg');
    const context = (ImageManipulator.manipulate as jest.Mock).mock.results[0].value as { resize: jest.Mock };
    expect(context.resize).toHaveBeenCalledWith({ width: 1024 });

    await fireEvent.press(screen.getByTestId('product-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/v1/admin/products',
      'POST /api/v1/admin/products/12/image',
    ]);
    const upload = writes[1];
    const headers = upload.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers.Accept).toBe('application/json');
    expect(upload.init.body).toBeInstanceOf(FormData);
    expect(formParts(upload)).toEqual([
      expect.objectContaining({
        fieldName: 'image',
        uri: 'file:///cache/manipulated.jpg',
        name: 'product-12.jpg',
        type: 'image/jpeg',
      }),
    ]);
  });

  it('keeps the saved product when the upload fails, and retries only the upload', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photos/pic.jpg', width: 800, height: 600 }],
    });
    // The server echoes exactly what was POSTed, so a retry has nothing to PATCH and only re-uploads.
    const created = makeProduct({ id: 12, name: 'Tapsilog', sku: null, description: null, cost_cents: 0 });
    let uploadAttempts = 0;
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'POST', path: '/api/v1/admin/products', reply: () => mockResponse(201, { data: created }) },
      {
        method: 'POST',
        path: '/api/v1/admin/products/12/image',
        reply: () => {
          uploadAttempts += 1;
          return uploadAttempts === 1
            ? mockResponse(422, { message: 'The image field must be an image.', errors: { image: ['The image field must be an image.'] } })
            : mockResponse(200, { data: created });
        },
      },
    ]);

    await renderWithQuery(<NewProductScreen />);
    await fillRequiredFields();
    await fireEvent.press(screen.getByTestId('image-choose'));
    await screen.findByTestId('image-pending-hint');
    // 800 px is already small enough: re-encoded, not resized.
    const context = (ImageManipulator.manipulate as jest.Mock).mock.results[0].value as { resize: jest.Mock };
    expect(context.resize).not.toHaveBeenCalledWith(expect.anything());

    await fireEvent.press(screen.getByTestId('product-save'));

    expect(await screen.findByTestId('image-error')).toHaveTextContent('The image field must be an image.');
    expect(screen.getByTestId('form-banner')).toHaveTextContent(/saved, but its image couldn't be uploaded/);
    expect(screen.getByText('Edit product')).toBeOnTheScreen();
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('product-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());

    const writes = calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`);
    expect(writes).toEqual([
      'POST /api/v1/admin/products',
      'POST /api/v1/admin/products/12/image',
      'POST /api/v1/admin/products/12/image',
    ]);
  });

  it('explains a denied camera permission and offers Settings', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      status: 'denied',
      canAskAgain: false,
      expires: 'never',
    });
    routeFetch([categoriesRoute]);

    await renderWithQuery(<NewProductScreen />);
    await fireEvent.press(screen.getByTestId('image-camera'));

    expect(await screen.findByTestId('image-error')).toHaveTextContent(/Camera access is off/);
    expect(screen.getByTestId('image-open-settings')).toBeOnTheScreen();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('keeps typed input when the tablet rotates into the two-pane layout', async () => {
    setWindowSize(REFERENCE_SIZES.tabletPortrait.width, REFERENCE_SIZES.tabletPortrait.height);
    routeFetch([categoriesRoute]);

    await renderWithQuery(<NewProductScreen />);
    await fireEvent.changeText(screen.getByTestId('product-name'), 'Longsilog');
    await fireEvent.changeText(screen.getByTestId('product-price'), '95');

    await act(async () => {
      setWindowSize(REFERENCE_SIZES.tabletLandscape.width, REFERENCE_SIZES.tabletLandscape.height);
    });

    expect(screen.getByTestId('product-name').props.value).toBe('Longsilog');
    expect(screen.getByTestId('product-price').props.value).toBe('95');
  });
});

describe('Product form: edit', () => {
  it('loads the product and PATCHes only the changed fields', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '7' });
    const egg = makeProduct();
    const { calls } = routeFetch([
      categoriesRoute,
      { method: 'GET', path: '/api/v1/admin/products/7', reply: () => mockResponse(200, { data: egg }) },
      {
        method: 'PATCH',
        path: '/api/v1/admin/products/7',
        reply: () => mockResponse(200, { data: { ...egg, price_cents: 5500, is_vatable: false } }),
      },
    ]);

    await renderWithQuery(<EditProductScreen />);

    expect(await screen.findByTestId('product-price')).toHaveProp('value', '50.00');
    expect(screen.getByTestId('product-cost').props.value).toBe('22.00');
    await fireEvent.changeText(screen.getByTestId('product-price'), '55');
    await fireEvent(screen.getByTestId('product-vatable'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('product-save'));

    await waitFor(() => expect(router.back).toHaveBeenCalled());
    const patch = calls.find((call) => call.method === 'PATCH');
    expect(jsonBody(patch!)).toEqual({ price_cents: 5500, is_vatable: false });
  });

  it('shows "Not found" for an unknown product', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '404' });
    routeFetch([categoriesRoute]);

    await renderWithQuery(<EditProductScreen />);

    expect(await screen.findByTestId('record-error')).toHaveTextContent(/Not found/);
  });
});
