import { describe, expect, it } from 'vitest';
import { isFullyVisible, stepScrollBehavior } from '../lib/scroll';

/*
 * The pricing page scrolls step 2 into view when a pass is chosen. These cases
 * pin the decision so a tall window never jumps and a phone always advances.
 */
describe('isFullyVisible', () => {
  it('is true only when the whole step is inside the viewport', () => {
    expect(isFullyVisible({ top: 0, bottom: 800 }, 800)).toBe(true);
    expect(isFullyVisible({ top: 120, bottom: 400 }, 800)).toBe(true);
  });

  it('is false when the step starts below the fold', () => {
    expect(isFullyVisible({ top: 900, bottom: 1400 }, 800)).toBe(false);
  });

  it('is false when the step is clipped by either edge', () => {
    // Already scrolled past the top of the step.
    expect(isFullyVisible({ top: -40, bottom: 300 }, 800)).toBe(false);
    // Taller than the viewport.
    expect(isFullyVisible({ top: 100, bottom: 1200 }, 800)).toBe(false);
  });
});

describe('stepScrollBehavior', () => {
  it('animates normally and jumps for reduced-motion users', () => {
    expect(stepScrollBehavior(false)).toBe('smooth');
    expect(stepScrollBehavior(true)).toBe('auto');
  });
});