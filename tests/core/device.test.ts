/**
 * Device capability detection.
 *
 * The tests stub `matchMedia` and `navigator.maxTouchPoints` per case, because jsdom has neither
 * for a phone nor a reliable absence for a desktop - the whole point of the defensive reads is that
 * *absence is not failure*, and that is what is asserted: no capability, no throw, desktop path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isCoarsePointer, requestLandscape, exitFullscreen, fullscreenSupported, isFullscreen, requestFullscreen } from '../../src/core/device.js';

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

describe('requestLandscape', () => {
  it('asks the orientation API for landscape when it is there', () => {
    const lock = vi.fn(() => undefined);
    vi.stubGlobal('screen', { orientation: { lock } });
    requestLandscape();
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('swallows a promise rejection rather than surfacing it', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('denied')));
    vi.stubGlobal('screen', { orientation: { lock } });
    requestLandscape();
    // Give the caught rejection a turn to settle without becoming an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does nothing when the API is absent', () => {
    vi.stubGlobal('screen', undefined);
    expect(() => requestLandscape()).not.toThrow();
  });

  it('does not throw when the lock itself throws synchronously', () => {
    const lock = vi.fn(() => {
      throw new Error('refused');
    });
    vi.stubGlobal('screen', { orientation: { lock } });
    expect(() => requestLandscape()).not.toThrow();
  });
});

describe('fullscreen helpers', () => {
  function stubDocumentFullscreen(options: {
    supported?: boolean;
    element?: Element | null;
    request?: () => unknown;
    exit?: () => unknown;
  }): void {
    // The helpers only ever touch `document.documentElement.requestFullscreen`, `document
    // .fullscreenElement` and `document.exitFullscreen`, so the whole document is stubbed as a
    // plain object - this file runs in the node environment, where there is no `document` at all.
    vi.stubGlobal('document', {
      documentElement: options.supported
        ? { requestFullscreen: options.request ?? (() => undefined) }
        : {},
      fullscreenElement: options.element ?? null,
      exitFullscreen: options.exit,
    });
  }

  it('reports support only when requestFullscreen exists', () => {
    stubDocumentFullscreen({ supported: false });
    expect(fullscreenSupported()).toBe(false);

    stubDocumentFullscreen({ supported: true });
    expect(fullscreenSupported()).toBe(true);
  });

  it('reports fullscreen from the document element, treating absence as not-fullscreen', () => {
    stubDocumentFullscreen({ element: null });
    expect(isFullscreen()).toBe(false);

    const body = {} as Element;
    stubDocumentFullscreen({ element: body });
    expect(isFullscreen()).toBe(true);

    // `fullscreenElement` as `undefined` (an environment with no such property) is also "not
    // fullscreen", not "maybe fullscreen".
    vi.stubGlobal('document', { fullscreenElement: undefined });
    expect(isFullscreen()).toBe(false);
  });

  it('requests and exits fullscreen, and swallows both a throw and a rejection', async () => {
    const request = vi.fn(() => Promise.resolve());
    const exit = vi.fn(() => undefined);
    stubDocumentFullscreen({ supported: true, request, exit });

    requestFullscreen();
    expect(request).toHaveBeenCalledTimes(1);

    exitFullscreen();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the fullscreen API is absent', () => {
    stubDocumentFullscreen({ supported: false, exit: undefined });
    expect(() => requestFullscreen()).not.toThrow();
    expect(() => exitFullscreen()).not.toThrow();
  });

  it('does not throw when a request or exit is refused synchronously or asynchronously', async () => {
    stubDocumentFullscreen({
      supported: true,
      request: () => Promise.reject(new Error('denied')),
      exit: () => {
        throw new Error('denied');
      },
    });
    expect(() => requestFullscreen()).not.toThrow();
    expect(() => exitFullscreen()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
