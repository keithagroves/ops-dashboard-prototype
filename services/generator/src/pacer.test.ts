import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFixedRatePacer } from "./pacer";

describe("createFixedRatePacer", () => {
  it("preserves the fractional period for 150 TPS with integer-millisecond timers", () => {
    const pacer = createFixedRatePacer(150, 0);
    let now = 0;

    for (let event = 0; event < 150; event += 1) {
      now += Math.ceil(pacer.delay(now));
      pacer.fired(now);
    }

    assert.ok(now >= 1_000 && now <= 1_001, `150 paced events took ${now}ms`);
  });

  it("does not create a catch-up burst after the event loop stalls", () => {
    const pacer = createFixedRatePacer(100, 0);
    pacer.fired(20);

    assert.equal(pacer.delay(20), 10);
  });
});
