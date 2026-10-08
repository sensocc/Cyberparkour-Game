/**
 * Doors.
 *
 * A door is the one piece of level geometry that changes at runtime, so it is
 * worth pinning down: which collider it is, when that collider stops blocking,
 * and that a reset puts it back. The renderer side is a rotation, and is checked
 * in the scene-builder suite; this is the state.
 */

import { describe, expect, it } from 'vitest';

import { vec3 } from '../../src/core/vec3.js';
import { DoorSystem } from '../../src/game/level/doors.js';
import type { DoorDefinition } from '../../src/game/level/levelData.js';
import { collider, world } from '../helpers/player.js';

const DOOR: DoorDefinition = {
  id: 'test-door',
  position: { x: 0, y: 1.1, z: 0 },
  size: { x: 1.4, y: 2.2, z: 0.3 },
  hinge: 'x-',
  openAngle: 2.1,
};

function setup(door: DoorDefinition = DOOR, options = {}) {
  const collisionWorld = world(collider(door.id, vec3(door.position.x, door.position.y, door.position.z), vec3(door.size.x, door.size.y, door.size.z), 'door'));
  const doors = new DoorSystem([door], collisionWorld, { swingSeconds: 1, reach: 2.5, ...options });
  return { world: collisionWorld, doors };
}

describe('DoorSystem', () => {
  it('starts closed and blocking', () => {
    const { world: collisionWorld, doors } = setup();
    expect(doors.isOpen('test-door')).toBe(false);
    expect(doors.openFraction('test-door')).toBe(0);
    expect(collisionWorld.isColliderEnabled('test-door')).toBe(true);
  });

  it('starts open, and out of the way, when the level says so', () => {
    const { world: collisionWorld, doors } = setup({ ...DOOR, open: true });
    expect(doors.isOpen('test-door')).toBe(true);
    expect(collisionWorld.isColliderEnabled('test-door')).toBe(false);
  });

  it('swings to a target and reports the frames that moved', () => {
    const { doors } = setup();
    doors.toggle('test-door');

    const half = doors.update(0.5);
    expect(half).toEqual([{ id: 'test-door', open: 0.5 }]);
    expect(doors.isSwinging('test-door')).toBe(true);

    const rest = doors.update(0.5);
    expect(rest).toEqual([{ id: 'test-door', open: 1 }]);
    expect(doors.isSwinging('test-door')).toBe(false);
    // Nothing to report once it has arrived, so the renderer is left alone.
    expect(doors.update(0.5)).toEqual([]);
  });

  it('stops blocking once it is more than half open', () => {
    const { world: collisionWorld, doors } = setup();

    doors.toggle('test-door');
    doors.update(0.4);
    expect(collisionWorld.isColliderEnabled('test-door'), 'still mostly shut').toBe(true);

    doors.update(0.2);
    expect(collisionWorld.isColliderEnabled('test-door'), 'now mostly open').toBe(false);
  });

  it('closes again, and blocks again', () => {
    const { world: collisionWorld, doors } = setup({ ...DOOR, open: true });

    doors.toggle('test-door');
    doors.update(1);
    expect(doors.isOpen('test-door')).toBe(false);
    expect(collisionWorld.isColliderEnabled('test-door')).toBe(true);
  });

  it('works the door the player is standing next to', () => {
    const { doors } = setup();
    expect(doors.toggleNear(vec3(1.5, 1, 0))).toBe('test-door');
    expect(doors.isSwinging('test-door')).toBe(true);
  });

  it('ignores a door that is out of reach', () => {
    const { doors } = setup();
    expect(doors.nearest(vec3(20, 1, 0))).toBeNull();
    expect(doors.toggleNear(vec3(0, 40, 0))).toBeNull();
    expect(doors.isSwinging('test-door')).toBe(false);
  });

  it('picks the nearer of two doors', () => {
    const other: DoorDefinition = { ...DOOR, id: 'other-door', position: { x: 10, y: 1.1, z: 0 } };
    const collisionWorld = world(
      collider('test-door', vec3(0, 1.1, 0), vec3(1.4, 2.2, 0.3), 'door'),
      collider('other-door', vec3(10, 1.1, 0), vec3(1.4, 2.2, 0.3), 'door'),
    );
    const doors = new DoorSystem([DOOR, other], collisionWorld, { reach: 4 });

    expect(doors.nearest(vec3(0.5, 1, 0))).toBe('test-door');
    expect(doors.nearest(vec3(9, 1, 0))).toBe('other-door');
  });

  it('toggles the door the player is nearest, not the first one', () => {
    const other: DoorDefinition = { ...DOOR, id: 'other-door', position: { x: 10, y: 1.1, z: 0 } };
    const collisionWorld = world(
      collider('test-door', vec3(0, 1.1, 0), vec3(1.4, 2.2, 0.3), 'door'),
      collider('other-door', vec3(10, 1.1, 0), vec3(1.4, 2.2, 0.3), 'door'),
    );
    const doors = new DoorSystem([DOOR, other], collisionWorld, { reach: 4 });

    expect(doors.toggleNear(vec3(9.4, 1, 0))).toBe('other-door');
    expect(doors.isSwinging('other-door')).toBe(true);
    expect(doors.isSwinging('test-door')).toBe(false);
  });

  it('returns every door to the state the level declared', () => {
    const { world: collisionWorld, doors } = setup();
    doors.toggle('test-door');
    doors.update(1);
    expect(doors.isOpen('test-door')).toBe(true);

    doors.reset();
    expect(doors.isOpen('test-door')).toBe(false);
    expect(doors.openFraction('test-door')).toBe(0);
    expect(collisionWorld.isColliderEnabled('test-door')).toBe(true);
  });

  it('snapshots every door, for a freshly created view', () => {
    const { doors } = setup({ ...DOOR, open: true });
    expect(doors.snapshot()).toEqual([{ id: 'test-door', open: 1 }]);
    expect(doors.doorIds).toEqual(['test-door']);
  });

  it('ignores an unknown id rather than throwing', () => {
    const { doors } = setup();
    expect(() => doors.toggle('nope')).not.toThrow();
    expect(doors.isOpen('nope')).toBe(false);
  });
});
