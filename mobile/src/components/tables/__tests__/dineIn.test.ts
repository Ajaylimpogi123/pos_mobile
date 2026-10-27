/**
 * Dine-in Tables & Tabs (docs/api-contract.md v1.26): the app-side rules:
 * the service charge % field, the table form checks, grouping by area,
 * the sidebar item that shows only while dine-in is on, and the tab print labels.
 */
import { elapsedLabel, groupByArea, minutesSince } from '@/components/tables/tableLabels';
import { visibleModuleGroups } from '@/constants/modules';
import { parseServiceChargePercent, serviceChargeText } from '@/hooks/settings/useDineInSettingsForm';
import { checkTableDraft } from '@/hooks/tables/useAdminTables';
import { jobLabel } from '@/printing/labels';
import { receiptServiceChargeBps } from '@/printing/render';
import type { AuthUser } from '@/services/types';
import { tabItemIdOfLine } from '@/stores/tabCarts';

describe('service charge %', () => {
  it('reads 0–20 with up to 2 decimals as basis points, no floats', () => {
    expect(parseServiceChargePercent('10')).toBe(1000);
    expect(parseServiceChargePercent('12.5')).toBe(1250);
    expect(parseServiceChargePercent('7.25%')).toBe(725);
    expect(parseServiceChargePercent('')).toBe(0);
    expect(parseServiceChargePercent('20')).toBe(2000);
    expect(parseServiceChargePercent('20.01')).toBeNull();
    expect(parseServiceChargePercent('abc')).toBeNull();
    expect(parseServiceChargePercent('1.234')).toBeNull();
  });

  it('shows basis points as the percentage typed', () => {
    expect(serviceChargeText(1000)).toBe('10');
    expect(serviceChargeText(1250)).toBe('12.5');
    expect(serviceChargeText(725)).toBe('7.25');
    expect(serviceChargeText(0)).toBe('0');
  });
});

describe('table form', () => {
  const draft = { id: null, name: ' 5 ', area: ' Patio ', seats: '4', sortOrder: '', isActive: true };

  it('trims and builds the body', () => {
    expect(checkTableDraft(draft)).toEqual({ body: { name: '5', area: 'Patio', seats: 4, sort_order: 0, is_active: true }, errors: {} });
    expect(checkTableDraft({ ...draft, area: '  ' }).body?.area).toBeNull();
  });

  it('shows the §B rules under their fields', () => {
    const result = checkTableDraft({ ...draft, name: 'T#1', seats: '0', sortOrder: '10000' });
    expect(result.body).toBeNull();
    expect(result.errors).toEqual({
      name: 'Use letters, numbers, spaces and hyphens only.',
      seats: 'Enter 1 to 50 seats.',
      sortOrder: 'Enter 0 to 9999.',
    });
    expect(checkTableDraft({ ...draft, name: 'ABCDEFGHIJK' }).errors.name).toBe('Use 10 characters or fewer.');
  });
});

describe('labels and grouping', () => {
  it('groups by area in the order received, "No area" for none', () => {
    const groups = groupByArea([
      { id: 1, area: 'Inside' },
      { id: 2, area: 'Inside' },
      { id: 3, area: 'Patio' },
      { id: 4, area: null },
    ]);
    expect(groups.map((group) => [group.title, group.items.map((item) => item.id)])).toEqual([
      ['Inside', [1, 2]],
      ['Patio', [3]],
      ['No area', [4]],
    ]);
  });

  it('elapsed time', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(minutesSince('2026-10-13T10:29:30Z', now)).toBe(90);
    expect(elapsedLabel(90)).toBe('1 h 30 min');
    expect(elapsedLabel(12)).toBe('12 min');
  });

  it('a settlement line key carries the tab item id', () => {
    expect(tabItemIdOfLine('tab-41')).toBe(41);
    expect(tabItemIdOfLine('line-3')).toBeNull();
  });

  it('names the tab print jobs', () => {
    const base = { printerRole: 'kitchen' as const, copyNo: 1, copies: 1, isReprint: false };
    expect(jobLabel({ ...base, kind: 'tab_round', queueNo: 2 })).toBe('Kitchen ticket, round 2');
    expect(jobLabel({ ...base, kind: 'tab_void', queueNo: 0, printerRole: 'bar' })).toBe('VOID bar ticket (table bill)');
    expect(jobLabel({ ...base, kind: 'bill', queueNo: 0, printerRole: 'cashier' })).toBe('Bill');
  });

  it('prints the service charge rate only when it gives the charge back exactly', () => {
    expect(receiptServiceChargeBps({ total_cents: 28270, service_charge_cents: 2570 }, 1000)).toBe(1000);
    expect(receiptServiceChargeBps({ total_cents: 28270, service_charge_cents: 2570 }, 1200)).toBeUndefined();
    expect(receiptServiceChargeBps({ total_cents: 25700, service_charge_cents: 0 }, 1000)).toBeUndefined();
  });
});

describe('sidebar', () => {
  const userWith = (permissions: string[]) => ({ permissions }) as unknown as AuthUser;
  const keys = (user: AuthUser, dineIn: boolean) =>
    visibleModuleGroups(user, { dineIn }).flatMap((group) => group.modules.map((module) => module.key));

  it('shows Tables whether dine-in is on or off (Table Management §A)', () => {
    const manager = userWith(['settings.manage']);
    expect(keys(manager, false)).toContain('tables');
    expect(keys(manager, true)).toContain('tables');
  });

  it('shows Tables for settings.manage or report.view, not for sale.create alone', () => {
    expect(keys(userWith(['report.view']), false)).toContain('tables');
    expect(keys(userWith(['sale.create']), true)).not.toContain('tables');
  });
});
