/**
 * The run: the clock, the pickups, the splits and the record.
 *
 * V0.5 turned the district into something you *complete*, so this is the state
 * that says whether you have, how long it took, and whether it was your best.
 * Everything here is plain numbers and a `Set`, which is what makes a time trial
 * testable without a browser: no DOM, no timers, no storage.
 *
 * Two decisions worth spelling out:
 *
 *  - **The clock starts when you do**, not when the session does. Standing on
 *    the spawn deciding where to go is not part of a run, so the first tick that
 *    reports movement is the first tick that counts.
 *  - **The finish is armed, not always live.** Crossing the goal only counts
 *    once every checkpoint is behind you, so a level cannot be finished by
 *    touching the line at the start - which is exactly the exploit a goal near
 *    the spawn would otherwise hand out.
 */

export interface RunOptions {
  readonly checkpointCount: number;
  /**
   * Whether the level has an NPC to hand out the quest.
   *
   * Absent means it does not, because a level without a cat has no way to give one and a shard
   * nobody can be asked for is a shard nobody can take.
   */
  readonly hasNpc?: boolean;
  readonly collectibleCount: number;
  /** The record already on the books, in seconds, or `null`. */
  readonly bestSeconds?: number | null;
}

/** One checkpoint's split. */
export interface RunSplit {
  /**
   * Index of the checkpoint in the level's list.
   *
   * Carried with the time, because a checkpoint *can* be skipped: an array
   * indexed by checkpoint would then have holes, and the results screen would
   * label a split with a checkpoint the run never touched.
   */
  readonly checkpoint: number;
  readonly seconds: number;
}

/** What a finished run amounted to. */
export interface RunResult {
  readonly seconds: number;
  readonly collected: number;
  readonly collectibleCount: number;
  /** In the order the route reached them. */
  readonly splits: readonly RunSplit[];
  /** Whether this run beat the previous record. */
  readonly improved: boolean;
  /** The record after this run. */
  readonly bestSeconds: number;
}

export interface RunSnapshot {
  /** True once the clock has started ticking. */
  readonly started: boolean;
  readonly finished: boolean;
  readonly elapsedSeconds: number;
  readonly collected: number;
  readonly collectibleCount: number;
  readonly checkpointsReached: number;
  readonly checkpointCount: number;
  readonly splits: readonly RunSplit[];
  readonly bestSeconds: number | null;
  /** Whether crossing the finish would count. */
  readonly goalArmed: boolean;
  /** Where the cat's quest is: nothing asked, asking, or reported back. */
  readonly quest: 'none' | 'taken' | 'done';
}

export class RunState {
  readonly checkpointCount: number;
  readonly collectibleCount: number;

  private best: number | null;
  private elapsed = 0;
  private started = false;
  private finished = false;
  private splits: RunSplit[] = [];
  private reached = 0;
  private readonly taken = new Set<string>();
  /** Whether the level has anybody in it to give the quest out. */
  private readonly hasNpc: boolean;
  /**
   * Where the run is in the cat's quest.
   *
   * `none` until the cat has been talked to, `taken` while the shards are being collected, `done`
   * once they all are and the cat has been told. **Nothing may be picked up in `none`**: the
   * shards are the quest, and a quest you can finish before you are given it is not one.
   */
  private quest: 'none' | 'taken' | 'done';
  /** Single pickups that are not part of the count: the phone. */
  private readonly secrets = new Set<string>();
  private improved = false;

  constructor(options: RunOptions) {
    this.checkpointCount = Math.max(0, options.checkpointCount);
    // A level with nobody in it hands out no quest: the district's own test levels have no cat, and
    // a shard nobody can be asked for is a shard nobody can take.
    this.hasNpc = options.hasNpc !== false;
    this.quest = this.hasNpc ? 'none' : 'taken';
    this.collectibleCount = Math.max(0, options.collectibleCount);
    this.best = options.bestSeconds ?? null;
  }

  /** Resets the clock and the score, and starts again from zero. */
  begin(): void {
    this.elapsed = 0;
    this.started = false;
    this.finished = false;
    this.splits = [];
    this.reached = 0;
    this.taken.clear();
    this.secrets.clear();
    this.quest = this.hasNpc ? 'none' : 'taken';
    this.improved = false;
  }

  /**
   * Advances the clock.
   *
   * @param moving whether the player is actually going anywhere this tick. The
   * clock does not start until they are, so a run begins at the first step.
   */
  tick(dt: number, moving: boolean): void {
    if (this.finished) return;
    if (!this.started) {
      if (!moving) return;
      this.started = true;
    }
    if (dt > 0) this.elapsed += dt;
  }

  /**
   * Records a checkpoint.
   *
   * @returns whether it was one the run had not reached yet, so the game only
   * announces real progress.
   */
  reachCheckpoint(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index <= this.reached - 1) return false;
    this.reached = index + 1;
    this.splits.push({ checkpoint: index, seconds: this.elapsed });
    return true;
  }

  /**
   * Takes a pickup. @returns whether it was there to take.
   *
   * **Gated by the quest.** Until the cat has asked, a shard is scenery - which is the whole point
   * of an NPC handing out the job rather than the level starting with eight open boxes. The phone
   * is the exception and is its own list, because it is a secret rather than one of the eight.
   */
  collect(id: string, options: { readonly secret?: boolean } = {}): boolean {
    if (options.secret) {
      if (this.secrets.has(id)) return false;
      this.secrets.add(id);
      return true;
    }
    // **Gated by the cat.** Until the quest has been taken a shard is scenery: eight unmarked
    // boxes on a kilometre of rooftops are not a quest, they are a scavenger hunt with no giver.
    if (this.quest === 'none') return false;
    if (this.taken.has(id)) return false;
    this.taken.add(id);
    return true;
  }

  /** Where the quest is: nothing taken, taking, or ready to report back. */
  get questState(): 'none' | 'taken' | 'done' {
    return this.quest;
  }

  /**
   * Accepts the quest from the cat, once.
   *
   * The second visit is the *report*, and it is what finishes the level - so this returns which
   * of the two happened rather than a bare true, because the caller has a different thing to say
   * in each case.
   */
  talkToNpc(): 'accepted' | 'reported' | 'waiting' {
    if (this.quest === 'none') {
      this.quest = 'taken';
      return 'accepted';
    }
    if (this.quest === 'taken') {
      if (this.taken.size < this.collectibleCount) return 'waiting';
      this.quest = 'done';
      return 'reported';
    }
    return 'waiting';
  }

  /** Whether the count includes a pickup: the phone is not one of the cat's eight. */
  get goalOpen(): boolean {
    return this.quest === 'done';
  }

  hasCollected(id: string): boolean {
    return this.secrets.has(id) || this.taken.has(id);
  }

  /** Whether a secret has been found: the phone. */
  hasSecret(id: string): boolean {
    return this.secrets.has(id);
  }

  /** Whether every pickup on the route has been taken. */
  get allCollected(): boolean {
    return this.collectibleCount > 0 && this.taken.size >= this.collectibleCount;
  }

  get reachedIndex(): number {
    return this.reached - 1;
  }

  /**
   * Whether the finish would count: every checkpoint behind you, and the cat told.
   *
   * The second half is V1.0. The finish is the *return* to the cat, so a player who sprints to the
   * end without ever being given the quest is not finished - they are early.
   */
  get armed(): boolean {
    const checkpointsDone = this.checkpointCount === 0 || this.reached >= this.checkpointCount;
    // And every shard in, and the cat told. A player who runs the checkpoints and arrives at the
    // cat empty-handed is early rather than done - and since a shard cannot be picked up before the
    // cat has asked, having them all *is* having taken the quest.
    // The *report*, not merely the collecting: the run ends when the cat has been told, which is the
    // return trip the quest is for.
    const questDone = this.collectibleCount === 0 || this.quest === 'done';
    // **And the shards are in.** The finish is the return trip to the cat, so a player who runs
    // the checkpoints and arrives empty-handed is early rather than done - and a level with no
    // shards in it is armed by its checkpoints alone, which is what keeps the tests about
    // checkpoints about checkpoints.
    return checkpointsDone && questDone;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Stops the clock and weighs the run against the record.
   *
   * @returns the result, or `null` when the run was not under way or is already
   * finished - finishing twice must not overwrite a good time with a later one.
   */
  finish(): RunResult | null {
    if (this.finished) return null;
    this.finished = true;

    const previous = this.best;
    // A run with no time on the clock is not a record. A level that could be
    // finished before the player had moved would otherwise write a zero that no
    // later run could ever beat - and the record is the one thing here that
    // outlives the session.
    this.improved = this.elapsed > 0 && (previous === null || this.elapsed < previous);
    if (this.improved) this.best = this.elapsed;

    return {
      seconds: this.elapsed,
      collected: this.taken.size,
      collectibleCount: this.collectibleCount,
      splits: [...this.splits],
      improved: this.improved,
      bestSeconds: this.best ?? this.elapsed,
    };
  }

  snapshot(): RunSnapshot {
    return {
      started: this.started,
      finished: this.finished,
      elapsedSeconds: this.elapsed,
      collected: this.taken.size,
      collectibleCount: this.collectibleCount,
      checkpointsReached: this.reached,
      checkpointCount: this.checkpointCount,
      splits: [...this.splits],
      bestSeconds: this.best,
      goalArmed: this.armed,
      quest: this.quest,
    };
  }
}

/**
 * Whether a trigger has been entered.
 *
 * A cylinder rather than a sphere: a checkpoint, a pickup and a finish line are
 * all "somewhere around here at roughly this height", and a player who runs past
 * one at speed is further away horizontally than they are vertically.
 */
export function withinTrigger(
  position: { readonly x: number; readonly y: number; readonly z: number },
  target: { readonly x: number; readonly y: number; readonly z: number },
  radius: number,
  heightTolerance: number,
): boolean {
  const dx = position.x - target.x;
  const dz = position.z - target.z;
  if (dx * dx + dz * dz > radius * radius) return false;
  return Math.abs(position.y - target.y) <= heightTolerance;
}

/**
 * A run time as `M:SS.CC`, or a placeholder when there is no time yet.
 *
 * Hundredths, not hundredths-of-a-frame: a time trial that cannot be compared to
 * the second is a time trial nobody can race.
 */
export function formatRunTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--.--';
  const hundredths = Math.round(seconds * 100);
  const minutes = Math.floor(hundredths / 6000);
  const rest = hundredths - minutes * 6000;
  const secs = Math.floor(rest / 100);
  const frac = rest - secs * 100;
  return `${minutes}:${String(secs).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

/** Where the record lives between sessions. */
export const BEST_TIME_STORAGE_KEY = 'cyberparkour.best-time.v1';

/** The slice of `localStorage` the record needs. */
export interface TimeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The stored record, or `null`.
 *
 * Defensive on purpose: storage can be absent (private browsing), full, or hold
 * something a previous version wrote, and none of those is a reason for a demo
 * not to start.
 */
export function readBestTime(store: TimeStore | null | undefined): number | null {
  if (!store) return null;
  try {
    const raw = store.getItem(BEST_TIME_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Writes the record, ignoring a store that refuses to take it. */
export function writeBestTime(store: TimeStore | null | undefined, seconds: number): void {
  if (!store || !Number.isFinite(seconds) || seconds <= 0) return;
  try {
    store.setItem(BEST_TIME_STORAGE_KEY, String(seconds));
  } catch {
    // A full or read-only store is not worth failing a run over.
  }
}
