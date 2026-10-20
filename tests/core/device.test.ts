/**
 * Device capability detection.
 *
 * The tests stub `matchMedia` and `navigator.maxTouchPoints` per case, because jsdom has neither
 * for a phone nor a reliable absence for a desktop - the whole point of the defensive reads is that
 * *absence is not failure*, and that is what is asserted: no capability, no throw, desktop path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCoarsePointer } from '../../src/core/device.js';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, media: '', onchange: null, addListener: () => {}, removeListener: () => {} })),
  );
}

function stubTouchPoints(count: number | undefined): void {
  const navigator = globalThis.navigator ?? {};
  vi.stubGlobal('navigator', {
    ...navigator,
    maxTouchPoints: count,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isCoarsePointer', () => {
  it('is false on a mouse-only machine', () => {
    stubMatchMedia(false);
    stubTouchPoints(0);
    expect(isCoarsePointer()).toBe(false);
  });

  it('is true when the pointer media query says coarse', () => {
    stubMatchMedia(true);
    stubTouchPoints(0);
    expect(isCoarsePointer()).toBe(true);
  });

  it('is true when touch points exist even without a matchMedia query', () => {
    // `(pointer: coarse)` answers "is the *primary* input coarse"; a machine can report a fine
    // pointer yet still have a touchscreen. The fallback is the touch points themselves.
    stubMatchMedia(false);
    stubTouchPoints(5);
    expect(isCoarsePointer()).toBe(true);
  });

  it('is false when nothing about the device can be read at all', () => {
    // Absence is not failure: an embedded browser with no `matchMedia` and no `navigator` still
    // gets a safe answer rather than a throw at boot.
    vi.stubGlobal('matchMedia', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(isCoarsePointer()).toBe(false);
  });
});
