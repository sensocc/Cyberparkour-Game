// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatNumber, formatVector } from '../../src/ui/dom.js';
import {
  DebugHud,
  describeGait,
  describeHealth,
  describeLocomotion,
  formatHudRows,
  type HudSnapshot,
} from '../../src/ui/hud.js';

const SNAPSHOT: HudSnapshot = {
  fps: 59.94,
  frameTimeMs: 16.68,
  worstFrameTimeMs: 250,
  position: { x: 12.5, y: -0.001, z: 3.5 },
  velocity: { x: 0, y: -0.5, z: -7.499 },
  speed: 7.516,
  yaw: Math.PI / 2,
  pitch: -0.5,
  grounded: true,
  groundId: 'roof-deck',
  stance: 'standing',
  locomotion: 'grounded',
  sprinting: false,
  alive: true,
  deaths: 0,
  health: 74,
  maxHealth: 100,
  frameCount: 1234,
  elapsedSeconds: 20.5,
  renderer: 'Test GPU',
};

describe('formatHudRows', () => {
  it('includes the values V0.0 requires: fps, velocity and coordinates', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));

    expect(rows.fps).toContain('59.9');
    expect(rows.fps).toContain('16.68 ms');
    expect(rows.pos).toContain('12.50');
    expect(rows.vel).toContain('-7.50');
    expect(rows.speed).toBe('7.52 m/s');
  });

  it('reports the look direction in degrees', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));
    expect(rows.look).toBe('yaw 90°  pitch -29°');
  });

  it('names the collider the player is standing on', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));
    expect(rows.state).toBe('grounded (roof-deck)');
  });

  it('reports a fallen player distinctly from an airborne one', () => {
    const rows = (snapshot: HudSnapshot): Record<string, string> =>
      Object.fromEntries(formatHudRows(snapshot).map((row) => [row.label, row.value]));

    expect(rows({ ...SNAPSHOT, grounded: false, locomotion: 'airborne' }).state).toBe('airborne');
    expect(rows({ ...SNAPSHOT, alive: false, locomotion: 'dead' }).state).toBe('DEAD');
  });

  it('reports frame count and elapsed time', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));
    expect(rows.frames).toBe('1234 in 20.5 s');
  });

  it('reports the GPU, or unknown when it cannot be read', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));
    expect(rows.gpu).toBe('Test GPU');

    const unknown = Object.fromEntries(
      formatHudRows({ ...SNAPSHOT, renderer: null }).map((row) => [row.label, row.value]),
    );
    expect(unknown.gpu).toBe('unknown');
  });

  it('renders non-finite numbers as NaN rather than "Infinity"', () => {
    const rows = Object.fromEntries(
      formatHudRows({ ...SNAPSHOT, fps: Number.NaN, position: { x: Number.NaN, y: 1, z: 2 } }).map(
        (row) => [row.label, row.value],
      ),
    );
    expect(rows.fps).toContain('NaN');
    expect(rows.pos).toContain('NaN');
  });

  it('always emits the same rows, in a stable order', () => {
    const labels = formatHudRows(SNAPSHOT).map((row) => row.label);
    expect(labels).toEqual(formatHudRows({ ...SNAPSHOT, fps: 1 }).map((row) => row.label));
    expect(labels).toContain('worst');
    expect(labels).toContain('gait');
    expect(labels).toContain('deaths');
  });

  it('names the locomotion mode, so crouch and sprint are visible', () => {
    const rows = (snapshot: HudSnapshot): Record<string, string> =>
      Object.fromEntries(formatHudRows(snapshot).map((row) => [row.label, row.value]));

    expect(rows({ ...SNAPSHOT, sprinting: true }).gait).toBe('sprint');
    expect(rows({ ...SNAPSHOT, sprinting: false }).gait).toBe('walk');
    expect(rows({ ...SNAPSHOT, stance: 'crouched', sprinting: true }).gait).toBe('crouch');
    expect(
      rows({ ...SNAPSHOT, velocity: { x: 0, y: 0, z: 0 } }).gait,
    ).toBe('idle');
  });

  it('names every locomotion mode', () => {
    const state = (locomotion: HudSnapshot['locomotion']): string =>
      describeLocomotion({ ...SNAPSHOT, locomotion });

    expect(state('grounded')).toBe('grounded (roof-deck)');
    expect(state('airborne')).toBe('airborne');
    expect(state('mantling')).toBe('MANTLING');
    expect(state('pulling-up')).toBe('PULL-UP');
    expect(state('hanging')).toBe('HANGING');
    expect(state('climbing')).toBe('CLIMBING');
    expect(state('sliding')).toBe('SLIDING');
    expect(state('dead')).toBe('DEAD');
    expect(describeLocomotion({ ...SNAPSHOT, alive: false })).toBe('DEAD');
    expect(describeLocomotion({ ...SNAPSHOT, groundId: null })).toBe('grounded');
  });

  it('shows health as a bar, so fall damage is legible', () => {
    expect(describeHealth(100, 100)).toBe('########## 100');
    expect(describeHealth(0, 100)).toBe('.......... 0');
    expect(describeHealth(50, 100)).toBe('#####..... 50');
    expect(describeHealth(41, 100)).toBe('####...... 41');
    // Guards against a divide-by-zero when health is not being tracked.
    expect(describeHealth(10, 0)).toBe('n/a');
  });

  it('reports health in the rows', () => {
    const rows = Object.fromEntries(formatHudRows(SNAPSHOT).map((row) => [row.label, row.value]));
    expect(rows.health).toBe('#######... 74');
  });

  it('counts deaths', () => {
    const rows = Object.fromEntries(formatHudRows({ ...SNAPSHOT, deaths: 7 }).map((row) => [row.label, row.value]));
    expect(rows.deaths).toBe('7');
  });
});

describe('describeGait', () => {
  it('prefers crouch over sprint', () => {
    expect(describeGait('crouched', true, 10)).toBe('crouch');
  });

  it('reports idle below a walking pace', () => {
    expect(describeGait('standing', false, 0)).toBe('idle');
    expect(describeGait('standing', true, 0.05)).toBe('idle');
  });

  it('distinguishes walking from sprinting', () => {
    expect(describeGait('standing', false, 7.5)).toBe('walk');
    expect(describeGait('standing', true, 11.5)).toBe('sprint');
  });
});

describe('DebugHud', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.append(container);
  });

  it('mounts a panel with every row', () => {
    const hud = new DebugHud(container);
    hud.setVisible(true);
    expect(container.querySelector('.hud')).not.toBeNull();
    expect(hud.isVisible).toBe(true);
    expect(container.querySelectorAll('.hud__label').length).toBe(formatHudRows(SNAPSHOT).length);
  });

  it('writes live values into the panel', () => {
    const hud = new DebugHud(container);
    hud.setVisible(true);
    hud.update(SNAPSHOT);

    const text = container.querySelector('.hud__list')?.textContent ?? '';
    expect(text).toContain('7.52 m/s');
    expect(text).toContain('roof-deck');
    expect(text).toContain('Test GPU');
  });

  it('skips the DOM write while hidden', () => {
    const hud = new DebugHud(container);
    hud.update(SNAPSHOT);
    hud.setVisible(false);

    const before = container.querySelector('.hud__list')?.textContent;
    hud.update({ ...SNAPSHOT, speed: 999 });
    expect(container.querySelector('.hud__list')?.textContent).toBe(before);
  });

  it('starts hidden, because it is developer information and this is a demo', () => {
    const hud = new DebugHud(container);
    expect(hud.isVisible).toBe(false);
    expect(container.querySelector('.hud')?.classList.contains('hud--hidden')).toBe(true);
  });

  it('toggle flips visibility and reports the new state', () => {
    const hud = new DebugHud(container);

    expect(hud.toggle()).toBe(true);
    expect(hud.isVisible).toBe(true);
    expect(container.querySelector('.hud')?.classList.contains('hud--hidden')).toBe(false);

    expect(hud.toggle()).toBe(false);
    expect(container.querySelector('.hud')?.classList.contains('hud--hidden')).toBe(true);
  });

  it('updates again once restored to visible', () => {
    const hud = new DebugHud(container);
    hud.setVisible(false);
    hud.setVisible(true);
    hud.update(SNAPSHOT);
    expect(container.querySelector('.hud__list')?.textContent).toContain('7.52 m/s');
  });

  it('destroy removes the panel', () => {
    const hud = new DebugHud(container);
    hud.destroy();
    expect(container.querySelector('.hud')).toBeNull();
  });

  it('is marked up as an accessible section', () => {
    new DebugHud(container);
    const section = container.querySelector('section.hud');
    expect(section?.getAttribute('aria-label')).toBe('Debug info');
  });

  it('does not attach pointer handlers, so it never steals clicks', () => {
    const hud = new DebugHud(container);
    hud.setVisible(true);
    const spy = vi.fn();
    hud.element.addEventListener('click', spy);
    hud.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // The listener fires, but nothing in the HUD changes state as a result.
    expect(spy).toHaveBeenCalled();
    expect(hud.isVisible).toBe(true);
  });
});

describe('dom formatting helpers', () => {
  it('formatVector pads each component for a stable width', () => {
    expect(formatVector({ x: 1, y: -2.5, z: 3 }, 2)).toBe('    1.00    -2.50     3.00');
  });

  it('formatVector renders non-finite components as NaN', () => {
    expect(formatVector({ x: Number.NaN, y: 0, z: 0 }, 1)).toContain('NaN');
    expect(formatVector({ x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, 1)).toContain('NaN');
  });

  it('formatNumber respects the decimal count', () => {
    expect(formatNumber(1.23456, 2)).toBe('1.23');
    expect(formatNumber(1, 0)).toBe('1');
    expect(formatNumber(Number.NaN)).toBe('NaN');
  });
});
