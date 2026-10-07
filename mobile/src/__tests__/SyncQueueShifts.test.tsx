/**
 * The Sync queue with shift events (docs/api-contract.md → Shifts &
 * Reporting → Outbox): a shift event the server rejected shows under Needs
 * attention with its message and Retry, like a sale.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import SyncQueueRoute from '@/app/(app)/(pos)/sync-queue';
import { offlineRepository } from '@/db/offlineRepository';
import { shiftRepository } from '@/db/shiftRepository';
import { useOfflineStore } from '@/stores/offline';
import { useSessionStore } from '@/stores/session';
import { requestOutboxSync } from '@/sync/outboxSync';
import { cashierUser, secureStoreMock } from '@/test-utils';
import { renderWithQuery, routeFetch } from '@/test-utils/catalog';
import { freshTestDatabase } from '@/test-utils/database';

jest.mock('@/db/client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  getDb: () => require('@/test-utils/database').currentTestDatabase(),
}));

jest.mock('@/sync/outboxSync', () => ({
  ...jest.requireActual<typeof import('@/sync/outboxSync')>('@/sync/outboxSync'),
  requestOutboxSync: jest.fn(async () => ({ outcome: 'done', retryAt: null, sent: 0, synced: 0, rejected: 0 })),
}));

const SHIFT = '01K6S00000000000000000000A';
const CASH = '01K6S00000000000000000000M';

beforeEach(async () => {
  await freshTestDatabase();
  useOfflineStore.getState().reset();
  secureStoreMock().__resetSecureStore();
  useSessionStore.getState().setSignedIn(cashierUser, '2099-09-25T01:30:00Z');
  routeFetch([]);
  await shiftRepository.openShift({ ulid: SHIFT, branchId: 1, openedAt: '2026-09-26T00:02:00Z', openedBy: { id: 3, name: 'Carla Cashier' }, openingFloatCents: 200000 });
  await shiftRepository.addCashMovement({
    ulid: CASH,
    shiftUlid: SHIFT,
    type: 'out',
    amountCents: 12050,
    reason: 'Ice',
    occurredAt: '2026-09-26T01:00:00Z',
    user: { id: 3, name: 'Carla Cashier' },
  });
});

it('lists the pending shift events and a rejected one with its message and Retry', async () => {
  await offlineRepository.markRejected(CASH, 'This shift belongs to another tablet.', '2026-09-26T01:01:00Z');
  await renderWithQuery(<SyncQueueRoute />);

  expect(await screen.findByTestId(`sync-shift-${SHIFT}`)).toBeOnTheScreen();
  expect(screen.getByText('Shift opened')).toBeOnTheScreen();
  expect(screen.getByText('Cash out ₱120.50')).toBeOnTheScreen();
  expect(screen.getByTestId(`sync-shift-${CASH}-error`)).toHaveTextContent('This shift belongs to another tablet.');
  expect(screen.getByTestId('sync-queue-summary')).toHaveTextContent('1 pending · 1 needs attention');

  await fireEvent.press(screen.getByTestId(`sync-shift-${CASH}-retry`));
  await waitFor(async () => expect(await offlineRepository.countOutbox()).toEqual({ pending: 2, needsAttention: 0 }));
  expect(requestOutboxSync).toHaveBeenCalledWith({ force: true });
});
