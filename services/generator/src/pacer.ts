interface TimerScheduler {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultScheduler: TimerScheduler = {
  now: () => performance.now(),
  setTimeout,
  clearTimeout,
};

/**
 * Deadline-based pacing preserves fractional periods such as 1000/150ms.
 * Node truncates fractional setInterval delays, which turns a nominal 150 TPS
 * interval into roughly 166 TPS. Carrying the fractional deadline forward
 * naturally alternates integer timer delays and keeps the long-run rate true.
 */
export function createFixedRatePacer(perSecond: number, startedAt = 0) {
  const periodMs = 1_000 / perSecond;
  let nextAt = startedAt + periodMs;

  return {
    delay(now: number): number {
      return Math.max(0, nextAt - now);
    },
    fired(now: number): void {
      nextAt += periodMs;
      // Do not emit a catch-up burst after an event-loop pause. Resume at the
      // requested cadence; operational telemetry is explicitly best effort.
      if (nextAt <= now) nextAt = now + periodMs;
    },
  };
}

export function startFixedRate(
  task: () => void,
  perSecond: number,
  scheduler: TimerScheduler = defaultScheduler,
): () => void {
  const pacer = createFixedRatePacer(perSecond, scheduler.now());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  const schedule = () => {
    timer = scheduler.setTimeout(() => {
      if (stopped) return;
      const firedAt = scheduler.now();
      pacer.fired(firedAt);
      task();
      schedule();
    }, pacer.delay(scheduler.now()));
  };

  schedule();
  return () => {
    stopped = true;
    scheduler.clearTimeout(timer);
  };
}
