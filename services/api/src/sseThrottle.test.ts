import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTrailingThrottle, type Scheduler } from "./sseThrottle";

class FakeScheduler implements Scheduler {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  now = () => this.nowMs;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  async advance(ms: number): Promise<void> {
    const target = this.nowMs + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;

      const [id, timer] = next;
      this.timers.delete(id);
      this.nowMs = timer.at;
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.nowMs = target;
  }
}

describe("createTrailingThrottle", () => {
  it("coalesces a burst into one run plus one trailing run", async () => {
    const scheduler = new FakeScheduler();
    const runs: number[] = [];
    const throttle = createTrailingThrottle(
      async () => {
        runs.push(scheduler.now());
      },
      500,
      { scheduler },
    );

    throttle.trigger();
    throttle.trigger();
    throttle.trigger();

    await scheduler.advance(499);
    assert.deepEqual(runs, []);
    await scheduler.advance(1);
    assert.deepEqual(runs, [500]);
    await scheduler.advance(499);
    assert.deepEqual(runs, [500]);
    await scheduler.advance(1);
    assert.deepEqual(runs, [500, 1000]);
  });

  it("never overlaps runs when another trigger arrives in flight", async () => {
    const scheduler = new FakeScheduler();
    let resolveFirst!: () => void;
    let runCount = 0;
    let active = 0;
    let maxActive = 0;
    const throttle = createTrailingThrottle(
      async () => {
        runCount += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (runCount === 1) await new Promise<void>((resolve) => (resolveFirst = resolve));
        active -= 1;
      },
      100,
      { scheduler },
    );

    throttle.trigger();
    await scheduler.advance(100);
    assert.equal(runCount, 1);

    throttle.trigger();
    throttle.trigger();
    assert.equal(runCount, 1);

    resolveFirst();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await scheduler.advance(99);
    assert.equal(runCount, 1);
    await scheduler.advance(1);
    assert.equal(runCount, 2);
    assert.equal(maxActive, 1);
  });

  it("cancels a scheduled run and ignores future triggers after stop", async () => {
    const scheduler = new FakeScheduler();
    let runCount = 0;
    const throttle = createTrailingThrottle(async () => {
      runCount += 1;
    }, 500, { scheduler });

    throttle.trigger();
    throttle.stop();
    throttle.trigger();
    await scheduler.advance(1_000);

    assert.equal(runCount, 0);
    assert.equal(scheduler.timers.size, 0);
  });

  it("reports task failures and remains usable", async () => {
    const scheduler = new FakeScheduler();
    const errors: unknown[] = [];
    let runCount = 0;
    const throttle = createTrailingThrottle(
      async () => {
        runCount += 1;
        if (runCount === 1) throw new Error("query failed");
      },
      50,
      { scheduler, onError: (error) => errors.push(error) },
    );

    throttle.trigger();
    await scheduler.advance(50);
    throttle.trigger();
    await scheduler.advance(50);

    assert.equal(runCount, 2);
    assert.equal((errors[0] as Error).message, "query failed");
  });
});
