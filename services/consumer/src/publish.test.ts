import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishWithRetry } from "./publish";

describe("publishWithRetry", () => {
  it("returns after the first successful attempt", async () => {
    let attempts = 0;
    await publishWithRetry(async () => {
      attempts += 1;
    });
    assert.equal(attempts, 1);
  });

  it("retries and succeeds on the third attempt", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await publishWithRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("redis unavailable");
      },
      { wait: async (delay) => { delays.push(delay); } },
    );

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [25, 25]);
  });

  it("gives up after exactly three failed attempts", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        publishWithRetry(
          async () => {
            attempts += 1;
            throw new Error("still down");
          },
          { wait: async () => undefined },
        ),
      /still down/,
    );
    assert.equal(attempts, 3);
  });

  it("treats a hung attempt as a failure", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        publishWithRetry(
          () => {
            attempts += 1;
            return new Promise(() => undefined);
          },
          { attemptTimeoutMs: 1, retryDelayMs: 0 },
        ),
      /exceeded 1ms/,
    );
    assert.equal(attempts, 3);
  });
});
