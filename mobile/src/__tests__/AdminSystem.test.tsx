/**
 * Hardening & Pilot (Phase 8) §E admin screens (`system.manage`): the Devices
 * list (platform filter, health chip, unsynced count), the retire 409 confirm
 * step, and the Error log (summary, filters, resolve).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import ErrorGroupRoute from '@/app/(app)/(admin)/error-log/[id]';
import ErrorLogIndexRoute from '@/app/(app)/(admin)/error-log/index';
import DeviceRoute from '@/app/(app)/(admin)/devices/[id]';
import DevicesIndexRoute from '@/app/(app)/(admin)/devices/index';
import { DeviceDetailScreen } from '@/components/system/DeviceDetailScreen';
import type { AdminDevice, AuthUser, ErrorGroup, ErrorGroupDetail } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { mockResponse, secureStoreMock } from '@/test-utils';
import { jsonBody, managerUser, page, renderWithQuery, routeFetch, type FetchCall } from '@/test-utils/catalog';

const FUTURE = '2099-09-25T01:30:00Z';
const DEVICES = '/api/v1/admin/devices';
const ERROR_LOG = '/api/v1/admin/error-log';

const admin: AuthUser = { ...managerUser, permissions: [...managerUser.permissions, 'system.manage'] };

function makeDevice(overrides: Partial<AdminDevice> = {}): AdminDevice {
  return {
    id: 2,
    code: 'T02',
    name: 'Counter tablet',
    platform: 'android',
    app_version: '1.0.0',
    last_seen_at: '2026-10-12T01:00:00Z',
    is_active: true,
    retired_at: null,
    last_user: { id: 3, name: 'Ana' },
    heartbeat: {
      outbox_pending: 5,
      outbox_failed: 0,
      oldest_pending_at: '2026-10-12T00:10:00Z',
      errors_pending: 0,
      last_catalogue_sync_at: '2026-10-12T00:00:00Z',
      last_stock_sync_at: null,
      storage_free_mb: 2048,
      os_version: '14',
      device_model: 'Galaxy Tab A9+',
      printers: [],
    },
    heartbeat_at: '2026-10-12T01:00:00Z',
    health: 'attention',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    id: 7,
    source: 'app',
    level: 'fatal',
    message: 'TypeError: undefined is not a function',
    status: 'open',
    occurrences: 3,
    first_seen_at: '2026-10-11T01:00:00Z',
    last_seen_at: '2026-10-12T01:00:00Z',
    app_versions: ['1.0.0'],
    resolved_at: null,
    resolved_by: null,
    latest: { occurred_at: '2026-10-12T01:00:00Z', screen: '/sell', app_version: '1.0.0', device: { id: 2, code: 'T02', name: 'Counter tablet' }, user: null },
    ...overrides,
  };
}

function callsTo(calls: FetchCall[], method: string, path: string): FetchCall[] {
  return calls.filter((call) => call.method === method && call.path === path);
}

beforeEach(() => {
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(admin, FUTURE);
});

it('lists devices with their health and unsynced count, and filters by platform', async () => {
  const { calls } = routeFetch([{ method: 'GET', path: DEVICES, reply: () => mockResponse(200, page([makeDevice()], null, DEVICES)) }]);
  await renderWithQuery(<DevicesIndexRoute />);

  expect(await screen.findByTestId('device-card-2-health')).toHaveTextContent('Needs attention');
  expect(screen.getByTestId('device-card-2-unsynced')).toHaveTextContent('5 unsynced sales');
  expect(calls[0].query.get('status')).toBe('active');

  await fireEvent.press(screen.getByTestId('devices-platform-web'));
  await waitFor(() => expect(calls.at(-1)?.query.get('platform')).toBe('web'));
});

it('the device detail loads GET /admin/devices/{id}', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '2' });
  const { calls } = routeFetch([
    { method: 'GET', path: `${DEVICES}/2`, reply: () => mockResponse(200, { data: makeDevice({ name: 'Front counter' }) }) },
  ]);
  await renderWithQuery(<DeviceRoute />);

  expect(await screen.findByTestId('device-detail-screen')).toBeOnTheScreen();
  expect(screen.getByText('T02 · Front counter')).toBeOnTheScreen();
  expect(screen.getByTestId('device-detail-pending')).toHaveTextContent('5');
  expect(callsTo(calls, 'GET', `${DEVICES}/2`)).toHaveLength(1);
});

it('a 404 shows "This device was not found." with Back', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '99' });
  const { calls } = routeFetch([
    { method: 'GET', path: `${DEVICES}/99`, reply: () => mockResponse(404, { message: 'Resource not found.' }) },
  ]);
  await renderWithQuery(<DeviceRoute />);

  expect(await screen.findByText('This device was not found.')).toBeOnTheScreen();
  expect(screen.getByTestId('form-back')).toBeOnTheScreen();
  // A 404 is not retried.
  expect(callsTo(calls, 'GET', `${DEVICES}/99`)).toHaveLength(1);
});

it('retire asks again with the server message on 409, then retires with confirm: true', async () => {
  const retirePath = `${DEVICES}/2/retire`;
  let attempt = 0;
  const { calls } = routeFetch([
    {
      method: 'POST',
      path: retirePath,
      reply: () => {
        attempt += 1;
        return attempt === 1
          ? mockResponse(409, { message: 'T02 still has 5 unsynced sales. Sync it first, or retire it anyway.', outbox_pending: 5 })
          : mockResponse(200, { data: makeDevice({ is_active: false, retired_at: '2026-10-12T02:00:00Z', health: 'retired' }) });
      },
    },
  ]);
  await renderWithQuery(<DeviceDetailScreen device={makeDevice()} />);

  await fireEvent.press(screen.getByTestId('device-retire'));
  await fireEvent.press(screen.getByTestId('device-retire-dialog-confirm'));
  expect(await screen.findByText('T02 still has 5 unsynced sales. Sync it first, or retire it anyway.')).toBeOnTheScreen();
  expect(jsonBody(callsTo(calls, 'POST', retirePath)[0] as FetchCall)).toEqual({});

  await fireEvent.press(screen.getByTestId('device-retire-dialog-confirm'));
  await waitFor(() => expect(callsTo(calls, 'POST', retirePath)).toHaveLength(2));
  expect(jsonBody(callsTo(calls, 'POST', retirePath)[1] as FetchCall)).toEqual({ confirm: true });
});

it('the error log shows the summary and filters by level', async () => {
  const { calls } = routeFetch([
    {
      method: 'GET',
      path: ERROR_LOG,
      reply: () => {
        const body = page([makeGroup()], null, ERROR_LOG) as { meta: Record<string, unknown> };
        body.meta.summary = { open: 4, open_fatal: 1, last_24h: 9 };
        return mockResponse(200, body);
      },
    },
  ]);
  await renderWithQuery(<ErrorLogIndexRoute />);

  expect(await screen.findByTestId('error-log-summary-open')).toHaveTextContent('4');
  expect(screen.getByTestId('error-log-summary-fatal')).toHaveTextContent('1');
  expect(screen.getByTestId('error-group-7-level')).toHaveTextContent('Fatal');
  expect(calls[0].query.get('status')).toBe('open');

  await fireEvent.press(screen.getByTestId('error-log-level-fatal'));
  await waitFor(() => expect(calls.at(-1)?.query.get('level')).toBe('fatal'));
});

it('an error group shows its events and resolves', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '7' });
  const detail: ErrorGroupDetail = {
    ...makeGroup(),
    events: [
      {
        ulid: '01J8Z3K5Q9V7X2M4N6P8R0T1W3',
        occurred_at: '2026-10-12T01:00:00Z',
        received_at: '2026-10-12T01:00:05Z',
        message: 'TypeError: undefined is not a function',
        stack: 'TypeError\n    at render (Sell.js:1:2)',
        context: { screen: '/sell', app_version: '1.0.0', os: 'android', extra: { source: 'error_boundary' } },
        device: { id: 2, code: 'T02', name: 'Counter tablet' },
        user: null,
      },
    ],
  };
  const { calls } = routeFetch([
    { method: 'GET', path: `${ERROR_LOG}/7`, reply: () => mockResponse(200, { data: detail }) },
    {
      method: 'POST',
      path: `${ERROR_LOG}/7/resolve`,
      reply: () => mockResponse(200, { data: makeGroup({ status: 'resolved', resolved_at: '2026-10-12T02:00:00Z', resolved_by: { id: 1, name: 'Owner' } }) }),
    },
  ]);
  await renderWithQuery(<ErrorGroupRoute />);

  expect(await screen.findByTestId('error-event-0-stack')).toBeOnTheScreen();
  expect(screen.getByText('error_boundary')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('error-group-resolve'));
  await waitFor(() => expect(callsTo(calls, 'POST', `${ERROR_LOG}/7/resolve`)).toHaveLength(1));
  expect(await screen.findByTestId('error-group-status')).toHaveTextContent('Resolved');
});
