/**
 * Device capability detection.
 *
 * Everything here reads browser APIs that are absent in some embedded browsers and in jsdom, so it
 * is written defensively - a capability that cannot be read is reported as "not present", and the
 * caller falls back to the desktop path rather than throwing at boot. The one rule the rest of the
 * game relies on is the same one `prefersReducedMotion` follows: *absence is not failure*.
 */

/**
 * Whether the primary pointer is touch, i.e. the session is on a phone or a tablet.
 *
 * `(pointer: coarse)` is the modern signal: it is true for touchscreens and false for mouse-only
 * machines, and it already accounts for hybrid laptops whose touchscreen is not how they are
 * driven. `maxTouchPoints` is the fallback for browsers without `matchMedia` for media queries.
 *
 * The answer decides *input*, not capability: a coarse pointer gets the virtual joystick and the
 * on-screen buttons, and a fine one keeps the keyboard and mouse.
 */
export function isCoarsePointer(): boolean {
  try {
    if (globalThis.matchMedia?.('(pointer: coarse)')?.matches === true) return true;
  } catch {
    // `matchMedia` exists but threw (an unusual embedded browser) - fall through to maxTouchPoints.
  }
  try {
    if ((globalThis.navigator?.maxTouchPoints ?? 0) > 0) return true;
  } catch {
    // No navigator at all; the desktop path is the safe default.
  }
  return false;
}

/**
 * Asks the browser to go landscape, best-effort.
 *
 * This game is built for a sideways phone, so on a touch device it is requested when play starts
 * (from the tap, which is what the platform requires). It is a *request*, never a promise: the
 * lock is refused outside fullscreen, iOS ignores it outright, and a desktop or a tablet in
 * portrait keeps whatever it had. The portrait "rotate your device" prompt is the reliable half;
 * this is the try for the browsers that will oblige.
 */
export function requestLandscape(): void {
  try {
    const orientation = (globalThis.screen as { orientation?: { lock?: (value: string) => unknown } }).orientation;
    if (typeof orientation?.lock !== 'function') return;
    const result = orientation.lock('landscape');
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // A refused lock is not an error worth surfacing: the prompt is already there.
  }
}
