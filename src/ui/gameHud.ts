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
  /** What the lift in front of the player is offering, if anything. */
  readonly prompt?: ElevatorPrompt | null;
  /**
   * Which way the nearest pickup is, and how far.
   *
   * The bearing is relative to where the player is looking, so "ahead" means ahead - and it is a
   * straight line rather than a route, because the city is a grid and the straight line is the
   * route within a street or two.
   */
  readonly hint?: { readonly bearing: number; readonly distance: number } | null;
}

/**
 * Something the player can do *right here*: a door, a lift, a floor.
 *
 * Its own shape rather than a string, because a prompt is two lines of text with a
 * different weight to each, and because the game should not have to know how a prompt
 * is drawn to say what it is.
 */
export interface ElevatorPrompt {
  readonly kind: 'call' | 'enter' | 'select';
  readonly title: string;
  readonly detail: string;
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
  /**
   * The last snapshot drawn.
   *
   * Kept because the HUD is the only thing that knows what the player was told, and "what was on
   * the screen when it went wrong" is the first question anybody asks of a bug report.
   */
  last: GameHudSnapshot | null = null;
  private readonly healthFill: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly checkpointLabel: HTMLElement;
  private readonly checkpointPips: HTMLElement;
  private readonly timeLabel: HTMLElement;
  private readonly pickupLabel: HTMLElement;
  private pips = 0;
  /** Last checkpoint index the pips were filled to. */
  private lastCheckpoint = -1;
  /** The lift prompt: two lines, hidden when there is nothing to do here. */
  private readonly hint: HTMLElement;
  private readonly hintArrow: HTMLElement;
  private readonly hintText: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptTitle: HTMLElement;
  private readonly promptDetail: HTMLElement;

  constructor() {
    this.hintArrow = document.createElement('span');
    this.hintArrow.className = 'hint__arrow';
    this.hintText = document.createElement('span');
    this.hintText.className = 'hint__text';
    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.append(this.hintArrow, this.hintText);

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
    this.element.append(this.hint);

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

    // The prompt sits in the middle of the screen rather than in the corner: it is
    // about what is *in front* of the player, and it is only there while it is true.
    this.prompt = document.createElement('div');
    this.prompt.className = 'prompt';
    this.promptTitle = document.createElement('p');
    this.promptTitle.className = 'prompt__title';
    this.promptDetail = document.createElement('p');
    this.promptDetail.className = 'prompt__detail';
    this.prompt.append(this.promptTitle, this.promptDetail);
    this.prompt.hidden = true;
    this.element.append(this.prompt);
  }

  update(snapshot: GameHudSnapshot): void {
    this.last = snapshot;
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
    // **The pointer.** A shard you cannot see is a shard you cannot look for, so the HUD carries a
    // bearing and a distance to the nearest one still out there - and only when there is one.
    const hint = snapshot.hint ?? null;
    const hintText = hint
      ? `${Math.round(hint.distance)} m`
      : '';
    if (this.hintText.textContent !== hintText) this.hintText.textContent = hintText;
    this.hint.style.transform = hint ? `rotate(${hint.bearing}rad)` : '';
    this.hint.classList.toggle('hint--off', hint === null);

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

    // The prompt, shown only while there is something to do.
    const prompt = snapshot.prompt ?? null;
    this.prompt.hidden = prompt === null;
    if (prompt) {
      this.prompt.dataset['kind'] = prompt.kind;
      this.setText(this.promptTitle, prompt.title);
      this.setText(this.promptDetail, prompt.detail);
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
