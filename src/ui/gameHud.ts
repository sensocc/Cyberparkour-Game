/**
 * The play HUD: health and checkpoint progress.
 *
 * Separate from the debug overlay on purpose. The debug overlay (F3) is for
 * developing the game - frame times, positions, velocity, mode names - and is
 * allowed to be ugly and constant. This is the one a player is supposed to look
 * at, so it shows two things and nothing else:
 *
 *  - **Health**, because fall damage is a real mechanic and an invisible resource
 *    is not a mechanic. A bar rather than a number, because the exact value is
 *    never a decision - the *band* is.
 *  - **Checkpoints**, because falling is how the district is traversed, and how
 *    much of the route survives a fall is the only progress worth showing.
 *
 * Everything here is derived from plain numbers, so the formatting is unit-tested
 * and the class itself only touches the DOM.
 */

import { clamp } from '../core/math.js';
import { formatRunTime } from '../game/run.js';

export interface GameHudSnapshot {
  readonly health: number;
  readonly maxHealth: number;
  /** Index of the last checkpoint reached, or -1 for none. */
  readonly checkpoint: number;
  /** How many checkpoints the level has. */
  readonly checkpointCount: number;
  /** Seconds on the clock. */
  readonly elapsedSeconds: number;
  /** Whether the clock is actually running. */
  readonly running: boolean;
  /** How many pickups have been taken. */
  readonly collected: number;
  /** How many pickups the level has. */
  readonly collectibleCount: number;
  /** Whether crossing the finish would count. */
  readonly goalArmed: boolean;
}

/** Health as 0..1, guarding against a missing or absurd maximum. */
export function healthFraction(health: number, maxHealth: number): number {
  if (!Number.isFinite(health) || !Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  return clamp(health / maxHealth, 0, 1);
}

/** Health as a rounded percentage, for the readout beside the bar. */
export function healthPercent(health: number, maxHealth: number): number {
  return Math.round(healthFraction(health, maxHealth) * 100);
}

/**
 * How much of the route has been secured.
 *
 * `reached` is an index, so "reached checkpoint 2" is 3 of 4 - the first
 * checkpoint counts as progress the same way the last one does.
 */
export function describeCheckpoints(reached: number, total: number): string {
  if (total <= 0) return 'no checkpoints';
  const secured = clamp(reached + 1, 0, total);
  return `CP ${secured} / ${total}`;
}

/** The band the health bar is in, used to colour it. */
export function healthBand(health: number, maxHealth: number): 'ok' | 'hurt' | 'critical' {
  const fraction = healthFraction(health, maxHealth);
  if (fraction <= 0.25) return 'critical';
  if (fraction <= 0.6) return 'hurt';
  return 'ok';
}

/**
 * The pickup counter.
 *
 * `taken` counts up rather than the remainder counting down: a run's score is
 * what you have, and a level with no pickups says so rather than showing `0 / 0`.
 */
export function describePickups(taken: number, total: number): string {
  if (total <= 0) return 'no pickups';
  return `${clamp(taken, 0, total)} / ${total}`;
}

export class GameHud {
  readonly element: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly checkpointLabel: HTMLElement;
  private readonly checkpointPips: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly pickupLabel: HTMLElement;
  private pips = 0;
  /** Last checkpoint index the pips were filled to. */
  private lastCheckpoint = -1;

  constructor() {
    this.healthFill = document.createElement('div');
    this.healthFill.className = 'vitals__fill';

    const healthBar = document.createElement('div');
    healthBar.className = 'vitals__bar';
    healthBar.append(this.healthFill);

    this.healthLabel = document.createElement('span');
    this.healthLabel.className = 'vitals__label';

    this.element = document.createElement('div');
    // Deliberately *not* `.hud`: that class belongs to the debug overlay, and
    // sharing it meant the debug panel's `top: 12px` beat this element's
    // `bottom: 20px` and dropped the play HUD over the debug rows.
    this.element.className = 'vitals';
    const vitals = document.createElement('div');
    vitals.className = 'vitals__row';
    vitals.append(this.healthLabel, healthBar);
    this.element.append(vitals);

    this.checkpointLabel = document.createElement('span');
    this.checkpointLabel.className = 'vitals__checkpoints';
    this.checkpointPips = document.createElement('span');
    this.checkpointPips.className = 'vitals__pips';
    this.element.append(this.checkpointLabel, this.checkpointPips);

    // The trial row: the clock on the left, the pickups on the right.
    this.timeLabel = document.createElement('span');
    this.timeLabel.className = 'vitals__time';
    this.pickupLabel = document.createElement('span');
    this.pickupLabel.className = 'vitals__pickups';
    const trial = document.createElement('div');
    trial.className = 'vitals__trial';
    trial.append(this.timeLabel, this.pickupLabel);
    this.element.append(trial);
  }

  update(snapshot: GameHudSnapshot): void {
    // This runs every frame while playing, because the clock has to move every
    // frame, so every write here is guarded: rewriting a dozen identical text
    // nodes sixty times a second is work the browser then has to notice.
    const fraction = healthFraction(snapshot.health, snapshot.maxHealth);
    // The bar is scaled rather than resized, so it animates on the compositor and
    // never triggers layout in the middle of a frame.
    const scale = `scaleX(${fraction})`;
    if (this.healthFill.style.transform !== scale) this.healthFill.style.transform = scale;

    const band = healthBand(snapshot.health, snapshot.maxHealth);
    if (this.element.dataset.health !== band) this.element.dataset.health = band;

    this.setText(this.healthLabel, `${healthPercent(snapshot.health, snapshot.maxHealth)}%`);
    this.setText(this.checkpointLabel, describeCheckpoints(snapshot.checkpoint, snapshot.checkpointCount));
    this.setText(this.timeLabel, formatRunTime(snapshot.elapsedSeconds));
    this.setText(this.pickupLabel, describePickups(snapshot.collected, snapshot.collectibleCount));

    // Attributes rather than class juggling, so the styling can say "the clock is
    // stopped" and "the finish is live" without the DOM being rearranged.
    const running = String(snapshot.running);
    if (this.element.dataset.running !== running) this.element.dataset.running = running;
    const armed = String(snapshot.goalArmed);
    if (this.element.dataset.armed !== armed) this.element.dataset.armed = armed;

    if (snapshot.checkpointCount !== this.pips) {
      this.pips = snapshot.checkpointCount;
      this.checkpointPips.replaceChildren(
        ...Array.from({ length: snapshot.checkpointCount }, () => {
          const pip = document.createElement('i');
          pip.className = 'vitals__pip';
          return pip;
        }),
      );
      // `replaceChildren` resets the pips to unfilled, so the fill has to be
      // redone even if the reached index itself did not change.
      this.lastCheckpoint = -1;
    }

    if (snapshot.checkpoint !== this.lastCheckpoint) {
      this.lastCheckpoint = snapshot.checkpoint;
      const buttons = this.checkpointPips.children;
      for (let index = 0; index < buttons.length; index += 1) {
        buttons[index]?.classList.toggle('vitals__pip--reached', index <= snapshot.checkpoint);
      }
    }
  }

  /** Writes text only when it has actually changed. */
  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  destroy(): void {
    this.element.remove();
  }
}
