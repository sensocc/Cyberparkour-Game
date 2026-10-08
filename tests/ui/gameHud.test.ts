/**
 * @vitest-environment jsdom
 *
 * The play HUD: a health bar and checkpoint progress.
 */

import { describe, expect, it } from 'vitest';

import {
  GameHud,
  describeCheckpoints,
  describePickups,
  healthBand,
  healthFraction,
  healthPercent,
  type GameHudSnapshot,
} from '../../src/ui/gameHud.js';

describe('health readouts', () => {
  it('scales health to a fraction, clamped', () => {
    expect(healthFraction(100, 100)).toBe(1);
    expect(healthFraction(50, 100)).toBe(0.5);
    expect(healthFraction(0, 100)).toBe(0);
    expect(healthFraction(-20, 100)).toBe(0);
    expect(healthFraction(500, 100)).toBe(1);
  });

  it('survives a nonsense maximum rather than dividing by zero', () => {
    expect(healthFraction(50, 0)).toBe(0);
    expect(healthFraction(50, Number.NaN)).toBe(0);
    expect(healthFraction(Number.NaN, 100)).toBe(0);
  });

  it('rounds to a percentage', () => {
    expect(healthPercent(100, 100)).toBe(100);
    expect(healthPercent(0, 100)).toBe(0);
    expect(healthPercent(74.6, 100)).toBe(75);
  });

  it('bands the bar so a scratch and a near miss do not look alike', () => {
    expect(healthBand(100, 100)).toBe('ok');
    expect(healthBand(61, 100)).toBe('ok');
    expect(healthBand(60, 100)).toBe('hurt');
    expect(healthBand(26, 100)).toBe('hurt');
    expect(healthBand(25, 100)).toBe('critical');
    expect(healthBand(0, 100)).toBe('critical');
  });
});

describe('checkpoint progress', () => {
  it('counts the checkpoint reached as progress', () => {
    // Index 0 is the first checkpoint, so it is 1 of 4 - not 0.
    expect(describeCheckpoints(0, 4)).toBe('CP 1 / 4');
    expect(describeCheckpoints(3, 4)).toBe('CP 4 / 4');
  });

  it('says so when nothing has been reached', () => {
    expect(describeCheckpoints(-1, 4)).toBe('CP 0 / 4');
  });

  it('handles a level with no checkpoints', () => {
    expect(describeCheckpoints(-1, 0)).toBe('no checkpoints');
  });

  it('never reports more progress than there is route', () => {
    expect(describeCheckpoints(9, 4)).toBe('CP 4 / 4');
  });
});

describe('pickup counts', () => {
  it('counts up towards the total', () => {
    expect(describePickups(0, 6)).toBe('0 / 6');
    expect(describePickups(2, 6)).toBe('2 / 6');
    expect(describePickups(6, 6)).toBe('6 / 6');
  });

  it('says so when the level has none', () => {
    expect(describePickups(0, 0)).toBe('no pickups');
  });

  it('never reports more than there is', () => {
    expect(describePickups(9, 4)).toBe('4 / 4');
  });
});

describe('GameHud', () => {
  function mount(): GameHud {
    const hud = new GameHud();
    document.body.append(hud.element);
    return hud;
  }

  /** A complete HUD snapshot, so each test only states the fields it cares about. */
  function snapshot(overrides: Partial<GameHudSnapshot> = {}): GameHudSnapshot {
    return {
      health: 100,
      maxHealth: 100,
      checkpoint: -1,
      checkpointCount: 4,
      elapsedSeconds: 0,
      running: false,
      collected: 0,
      collectibleCount: 0,
      goalArmed: false,
      ...overrides,
    };
  }

  it('shows the health as a bar and a percentage', () => {
    const hud = mount();
    hud.update(snapshot({ health: 75, maxHealth: 100, checkpoint: -1, checkpointCount: 3 }));

    expect(hud.element.querySelector('.vitals__label')?.textContent).toBe('75%');
    const fill = hud.element.querySelector('.vitals__fill') as HTMLElement;
    expect(fill.style.transform).toBe('scaleX(0.75)');
    hud.destroy();
  });

  it('colours the bar by how much is left', () => {
    const hud = mount();
    hud.update(snapshot({ health: 20, maxHealth: 100, checkpoint: -1, checkpointCount: 3 }));
    expect(hud.element.dataset.health).toBe('critical');
    hud.update(snapshot({ health: 90, maxHealth: 100, checkpoint: -1, checkpointCount: 3 }));
    expect(hud.element.dataset.health).toBe('ok');
    hud.destroy();
  });

  it('shows one pip per checkpoint, filling them in as they are reached', () => {
    const hud = mount();
    hud.update(snapshot({ health: 100, maxHealth: 100, checkpoint: 1, checkpointCount: 4 }));

    const pips = hud.element.querySelectorAll('.vitals__pip');
    expect(pips).toHaveLength(4);
    const reached = hud.element.querySelectorAll('.vitals__pip--reached');
    expect(reached).toHaveLength(2);
    expect(hud.element.textContent).toContain('CP 2 / 4');
    hud.destroy();
  });

  it('does not rebuild the pips when the count has not changed', () => {
    const hud = mount();
    hud.update(snapshot({ health: 100, maxHealth: 100, checkpoint: 0, checkpointCount: 4 }));
    const first = hud.element.querySelector('.vitals__pip');
    hud.update(snapshot({ health: 50, maxHealth: 100, checkpoint: 2, checkpointCount: 4 }));
    const again = hud.element.querySelector('.vitals__pip');
    expect(again).toBe(first);
    hud.destroy();
  });

  it('rebuilds them when the level changes', () => {
    const hud = mount();
    hud.update(snapshot({ health: 100, maxHealth: 100, checkpoint: -1, checkpointCount: 2 }));
    hud.update(snapshot({ health: 100, maxHealth: 100, checkpoint: -1, checkpointCount: 5 }));
    expect(hud.element.querySelectorAll('.vitals__pip')).toHaveLength(5);
    hud.destroy();
  });

  it('removes itself on destroy', () => {
    const hud = mount();
    hud.destroy();
    expect(document.querySelector('.vitals')).toBeNull();
  });

  it('shows the clock and the pickups', () => {
    const hud = mount();
    hud.update(snapshot({ elapsedSeconds: 62.5, collected: 3, collectibleCount: 8 }));

    expect(hud.element.querySelector('.vitals__time')?.textContent).toBe('1:02.50');
    expect(hud.element.querySelector('.vitals__pickups')?.textContent).toBe('3 / 8');
    hud.destroy();
  });

  it('says when the clock is running and when the finish is armed', () => {
    const hud = mount();

    hud.update(snapshot({ running: false, goalArmed: false }));
    expect(hud.element.dataset.running).toBe('false');
    expect(hud.element.dataset.armed).toBe('false');

    hud.update(snapshot({ running: true, goalArmed: true }));
    expect(hud.element.dataset.running).toBe('true');
    expect(hud.element.dataset.armed).toBe('true');
    hud.destroy();
  });
});
