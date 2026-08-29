interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultScheduler: Scheduler = {
  now: Date.now,
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface TrailingThrottleOptions {
  scheduler?: Scheduler;
  onError?: (error: unknown) => void;
}

/**
 * Runs an async task one at a time with a minimum interval between completed
 * runs. Any number of triggers while a run is pending/in flight collapse into
 * one trailing run, which is the behavior an SSE client needs during a burst
 * of database update notifications.
 */
export function createTrailingThrottle(
  task: () => Promise<void>,
  minIntervalMs: number,
  options: TrailingThrottleOptions = {},
): { trigger: () => void; stop: () => void } {
  const scheduler = options.scheduler ?? defaultScheduler;
  let running = false;
  let queued = false;
  let stopped = false;
  let timer: unknown;
  let lastCompletedAt = scheduler.now();

  const trigger = () => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }

    running = true;
    const wait = Math.max(0, minIntervalMs - (scheduler.now() - lastCompletedAt));
    timer = scheduler.setTimeout(() => {
      timer = undefined;
      if (stopped) {
        running = false;
        return;
      }

      void task()
        .catch((error) => options.onError?.(error))
        .finally(() => {
          lastCompletedAt = scheduler.now();
          running = false;
          if (queued && !stopped) {
            queued = false;
            trigger();
          }
        });
    }, wait);
  };

  const stop = () => {
    stopped = true;
    queued = false;
    if (timer !== undefined) {
      scheduler.clearTimeout(timer);
      timer = undefined;
      running = false;
    }
  };

  return { trigger, stop };
}

export type { Scheduler };
