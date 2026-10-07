/**
 * Test-only: turn the display feature flags (`constants/features.ts`) on or
 * off for one test. Never import from app code.
 */
import * as features from '@/constants/features';

/**
 * Makes `showVatBreakdown()` return `on` until the returned spy is restored
 * (`spy.mockRestore()`, e.g. in an `afterEach`).
 */
export function mockVatBreakdown(on: boolean): jest.SpyInstance<boolean, []> {
  return jest.spyOn(features, 'showVatBreakdown').mockReturnValue(on);
}
