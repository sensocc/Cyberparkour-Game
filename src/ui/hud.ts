/**
 * Debug HUD.
 *
 * V0.0 requires FPS, player velocity and player coordinates on screen. The
 * formatting is a pure function so it can be asserted directly in tests, and
 * the DOM is refreshed on a timer rather than every frame to keep layout out of
 * the frame budget.
 */

import type { ReadonlyVec3 } from '../core/vec3.js';
import { el, formatNumber, formatVector } from './dom.js';

export interface HudSnapshot {
  readonly fps: number;
  readonly frameTimeMs: number;
  readonly worstFrameTimeMs: number;
  readonly position: ReadonlyVec3;
  readonly velocity: ReadonlyVec3;
  readonly speed: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly grounded: boolean;
  readonly groundId: string | null;
  readonly frameCount: number;
  readonly elapsedSeconds: number;
  readonly renderer: string | null;
}

export interface HudRow {
  readonly label: string;
  readonly value: string;
}

/** Builds the HUD's display rows. Pure and unit-tested. */
export function formatHudRows(snapshot: HudSnapshot): HudRow[] {
  const yawDegrees = ((snapshot.yaw * 180) / Math.PI).toFixed(0);
  const pitchDegrees = ((snapshot.pitch * 180) / Math.PI).toFixed(0);

  return [
    { label: 'fps', value: `${formatNumber(snapshot.fps, 1)} (${formatNumber(snapshot.frameTimeMs, 2)} ms)` },
    { label: 'worst', value: `${formatNumber(snapshot.worstFrameTimeMs, 2)} ms` },
    { label: 'pos', value: formatVector(snapshot.position) },
    { label: 'vel', value: formatVector(snapshot.velocity) },
    { label: 'speed', value: `${formatNumber(snapshot.speed, 2)} m/s` },
    { label: 'look', value: `yaw ${yawDegrees}\u00b0  pitch ${pitchDegrees}\u00b0` },
    { label: 'state', value: snapshot.grounded ? `grounded${snapshot.groundId ? ` (${snapshot.groundId})` : ''}` : 'airborne' },
    { label: 'frames', value: `${snapshot.frameCount} in ${formatNumber(snapshot.elapsedSeconds, 1)} s` },
    { label: 'gpu', value: snapshot.renderer ?? 'unknown' },
  ];
}

export class DebugHud {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();
  private visible = true;

  constructor(container: HTMLElement) {
    this.root = el('section', { className: 'hud', attrs: { 'aria-label': 'Debug info' } });
    const heading = el('h2', { className: 'hud__heading', text: 'DEBUG' });
    this.list = el('dl', { className: 'hud__list' });

    this.root.append(heading, this.list);
    container.append(this.root);

    // Create the rows once; `update` only writes text.
    for (const row of formatHudRows(EMPTY_SNAPSHOT)) {
      const label = el('dt', { className: 'hud__label', text: row.label });
      const value = el('dd', { className: 'hud__value', text: row.value });
      this.values.set(row.label, value);
      this.list.append(label, value);
    }
  }

  get element(): HTMLElement {
    return this.root;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  update(snapshot: HudSnapshot): void {
    if (!this.visible) return;
    for (const row of formatHudRows(snapshot)) {
      const target = this.values.get(row.label);
      if (target) target.textContent = row.value;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('hud--hidden', !visible);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  destroy(): void {
    this.root.remove();
    this.values.clear();
  }
}

const EMPTY_SNAPSHOT: HudSnapshot = {
  fps: 0,
  frameTimeMs: 0,
  worstFrameTimeMs: 0,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  speed: 0,
  yaw: 0,
  pitch: 0,
  grounded: false,
  groundId: null,
  frameCount: 0,
  elapsedSeconds: 0,
  renderer: null,
};
