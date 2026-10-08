/**
 * Doors: the runtime state of a swinging panel.
 *
 * A door is a collider the physics cannot express statically: closed it blocks,
 * open it does not, and in between it is somewhere in the middle. So the level
 * declares the doors, `CollisionWorld` gains the ability to switch a collider
 * off, and this class is the small amount of state in between - which door is
 * open, how far, and which one the player is standing next to.
 *
 * It is deliberately independent of the renderer: `update` returns the fractions
 * that changed and the view does the turning, so the whole thing is testable
 * without WebGL.
 */

import type { ReadonlyVec3 } from '../../core/vec3.js';
import type { AABB } from '../physics/aabb.js';
import type { CollisionWorld } from '../physics/collision.js';
import type { DoorDefinition } from './levelData.js';

/**
 * How far open a door must be before it stops blocking.
 *
 * Halfway: a door that is still visibly shut should still stop you, and a door
 * that is mostly open should not. The gap between the mesh and the collider in
 * between is a deliberate simplification - modelling a *swinging* box is a
 * swept-rotation problem this demo does not need.
 */
const OPEN_THRESHOLD = 0.5;

export interface DoorSystemOptions {
  /** Seconds a door takes to swing fully open or shut. */
  readonly swingSeconds?: number;
  /** How close the player must be to work a door (m). */
  readonly reach?: number;
}

/** A door whose opening fraction changed this frame, for the renderer. */
export interface DoorUpdate {
  readonly id: string;
  readonly open: number;
}

export class DoorSystem {
  private readonly world: CollisionWorld;
  private readonly swingSpeed: number;
  private readonly reach: number;
  private readonly ids: readonly string[];
  private readonly boxes = new Map<string, AABB>();
  private readonly initial = new Map<string, number>();
  private readonly open = new Map<string, number>();
  private readonly target = new Map<string, number>();

  constructor(
    definitions: readonly DoorDefinition[],
    world: CollisionWorld,
    options: DoorSystemOptions = {},
  ) {
    this.world = world;
    this.swingSpeed = 1 / Math.max(0.05, options.swingSeconds ?? 0.7);
    this.reach = options.reach ?? 2.5;
    this.ids = definitions.map((door) => door.id);

    for (const door of definitions) {
      const start = door.open === true ? 1 : 0;
      this.initial.set(door.id, start);
      this.open.set(door.id, start);
      this.target.set(door.id, start);
    }

    // The collider box per door, read once so the reach test allocates nothing.
    for (const collider of world.colliders) {
      if (this.initial.has(collider.id)) this.boxes.set(collider.id, collider.box);
    }

    this.applyColliders();
  }

  get doorIds(): readonly string[] {
    return this.ids;
  }

  /** Returns every door to the state the level declared it in. */
  reset(): void {
    for (const [id, start] of this.initial) {
      this.open.set(id, start);
      this.target.set(id, start);
    }
    this.applyColliders();
  }

  /**
   * Advances the swing, and reports what moved.
   *
   * @returns one entry per door that changed this frame, so a renderer only has
   * to touch the doors that are actually moving.
   */
  update(dt: number): DoorUpdate[] {
    const step = this.swingSpeed * Math.max(0, dt);
    const changes: DoorUpdate[] = [];

    for (const id of this.ids) {
      const current = this.open.get(id) ?? 0;
      const target = this.target.get(id) ?? 0;
      if (current === target) continue;

      const next = target > current ? Math.min(target, current + step) : Math.max(target, current - step);
      this.open.set(id, next);
      changes.push({ id, open: next });
    }

    if (changes.length > 0) this.applyColliders();
    return changes;
  }

  /** Opens a closed door, or closes an open one. */
  toggle(id: string): void {
    if (!this.target.has(id)) return;
    this.target.set(id, (this.target.get(id) ?? 0) >= 0.5 ? 0 : 1);
  }

  /**
   * Toggles whichever door the player is nearest, if it is within reach.
   *
   * @returns the id that was worked, or `null` when no door was near enough.
   */
  toggleNear(position: ReadonlyVec3): string | null {
    const id = this.nearest(position);
    if (id === null) return null;
    this.toggle(id);
    return id;
  }

  /** The nearest door within reach, or `null`. */
  nearest(position: ReadonlyVec3): string | null {
    let best: string | null = null;
    let bestSquared = this.reach * this.reach;

    for (const [id, box] of this.boxes) {
      const dx = Math.max(box.min.x - position.x, 0, position.x - box.max.x);
      const dy = Math.max(box.min.y - position.y, 0, position.y - box.max.y);
      const dz = Math.max(box.min.z - position.z, 0, position.z - box.max.z);
      const squared = dx * dx + dy * dy + dz * dz;
      if (squared <= bestSquared) {
        bestSquared = squared;
        best = id;
      }
    }

    return best;
  }

  isOpen(id: string): boolean {
    return (this.open.get(id) ?? 0) >= OPEN_THRESHOLD;
  }

  openFraction(id: string): number {
    return this.open.get(id) ?? 0;
  }

  /** Every door's current fraction, for applying to a freshly created view. */
  snapshot(): DoorUpdate[] {
    return this.ids.map((id) => ({ id, open: this.open.get(id) ?? 0 }));
  }

  isSwinging(id: string): boolean {
    return (this.open.get(id) ?? 0) !== (this.target.get(id) ?? 0);
  }

  private applyColliders(): void {
    for (const [id, value] of this.open) {
      this.world.setColliderEnabled(id, value < OPEN_THRESHOLD);
    }
  }
}
