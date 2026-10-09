/**
 * Debug HUD.
 *
 * V0.0 requires FPS, player velocity and player coordinates on screen; V0.1 adds
 * the locomotion state, because "is the crouch actually applied?" is otherwise
 * invisible. The formatting is a pure function so it can be asserted directly in
 * tests, and the DOM is refreshed on a timer rather than every frame to keep
 * layout out of the frame budget.
 */

import type { ReadonlyVec3 } from '../core/vec3.js';
import type { Locomotion, Stance } from '../game/player.js';
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
  readonly stance: Stance;
  /** What the player is doing: grounded, hanging, sliding, ... */
  readonly locomotion: Locomotion;
  /** Whether the sprint key is held right now. */
  readonly sprinting: boolean;
  readonly alive: boolean;
  readonly deaths: number;
  /** Remaining health, or `null` when it is irrelevant (dead, or not tracking). */
  readonly health: number;
  readonly maxHealth: number;
  readonly frameCount: number;
  readonly elapsedSeconds: number;
  readonly renderer: string | null;
}

export interface HudRow {
  readonly label: string;
  readonly value: string;
}

/**
 * Names the current way of moving.
 *
 * Being able to read the gait and the locomotion off the HUD is how you confirm
 * the movement abilities are doing anything at all.
 */
export function describeGait(stance: Stance, sprinting: boolean, horizontalSpeed: number): string {
  if (stance === 'rolling') return 'roll';
  if (stance === 'crouched') return 'crouch';
  if (horizontalSpeed < 0.1) return 'idle';
  return sprinting ? 'sprint' : 'walk';
}

/** The locomotion mode, spelled out for the HUD. */
export function describeLocomotion(snapshot: HudSnapshot): string {
  if (!snapshot.alive) return 'DEAD';
  switch (snapshot.locomotion) {
    case 'mantling':
      return 'MANTLING';
    case 'pulling-up':
      return 'PULL-UP';
    case 'hanging':
      return 'HANGING';
    case 'climbing':
      return 'CLIMBING';
    case 'piping':
      return 'PIPE';
    case 'sliding':
      return 'SLIDING';
    case 'wall-running':
      return 'WALL RUN';
    case 'vaulting':
      return 'VAULTING';
    case 'rolling':
      return 'ROLLING';
    case 'airborne':
      return 'airborne';
    case 'grounded':
      return snapshot.groundId ? `grounded (${snapshot.groundId})` : 'grounded';
    case 'dead':
      return 'DEAD';
  }
}

/**
 * Health as a bar, so fall damage is legible at a glance.
 *
 * The debug overlay's version; the *play* HUD has a real bar.
 */
export function describeHealth(health: number, maxHealth: number): string {
  if (!(maxHealth > 0)) return 'n/a';
  const filled = Math.round(Math.max(0, Math.min(1, health / maxHealth)) * 10);
  return `${'#'.repeat(filled)}${'.'.repeat(10 - filled)} ${Math.round(health)}`;
}

/** Builds the HUD's display rows. Pure and unit-tested. */
export function formatHudRows(snapshot: HudSnapshot): HudRow[] {
  const yawDegrees = ((snapshot.yaw * 180) / Math.PI).toFixed(0);
  const pitchDegrees = ((snapshot.pitch * 180) / Math.PI).toFixed(0);
  const horizontalSpeed = Math.hypot(snapshot.velocity.x, snapshot.velocity.z);

  return [
    { label: 'fps', value: `${formatNumber(snapshot.fps, 1)} (${formatNumber(snapshot.frameTimeMs, 2)} ms)` },
    { label: 'worst', value: `${formatNumber(snapshot.worstFrameTimeMs, 2)} ms` },
    { label: 'pos', value: formatVector(snapshot.position) },
    { label: 'vel', value: formatVector(snapshot.velocity) },
    { label: 'speed', value: `${formatNumber(snapshot.speed, 2)} m/s` },
    { label: 'gait', value: describeGait(snapshot.stance, snapshot.sprinting, horizontalSpeed) },
    { label: 'health', value: describeHealth(snapshot.health, snapshot.maxHealth) },
    { label: 'look', value: `yaw ${yawDegrees}\u00b0  pitch ${pitchDegrees}\u00b0` },
    { label: 'state', value: describeLocomotion(snapshot) },
    { label: 'deaths', value: String(snapshot.deaths) },
    { label: 'frames', value: `${snapshot.frameCount} in ${formatNumber(snapshot.elapsedSeconds, 1)} s` },
    { label: 'gpu', value: snapshot.renderer ?? 'unknown' },
  ];
}

export class DebugHud {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();
  /**
   * Hidden until asked for.
   *
   * V0.6's UI pass: the debug overlay was on by default, which made a technical
   * demo look like a development build. F3 (or the backtick) brings it back, and the
   * controls screen says so.
   */
  private visible = false;

  constructor(container: HTMLElement) {
    this.root = el('section', { className: 'hud', attrs: { 'aria-label': 'Debug info' } });
    const heading = el('h2', { className: 'hud__heading', text: 'DEBUG' });
    this.list = el('dl', { className: 'hud__list' });

    this.root.append(heading, this.list);
    // Apply the starting state now rather than waiting for the first toggle, or the
    // overlay would be on screen until something happened to hide it.
    this.root.classList.toggle('hud--hidden', !this.visible);
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
  stance: 'standing',
  locomotion: 'grounded',
  sprinting: false,
  alive: true,
  deaths: 0,
  health: 100,
  maxHealth: 100,
  frameCount: 0,
  elapsedSeconds: 0,
  renderer: null,
};
