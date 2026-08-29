import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleSubscription } from "./redisSub";

describe("settleSubscription", () => {
  it("consumes an asynchronous SUBSCRIBE rejection and delegates recovery", async () => {
    const failure = new Error("redis unavailable");
    const reported: string[] = [];
    let recoveredWith: unknown;

    await assert.doesNotReject(() =>
      settleSubscription(
        () => Promise.reject(failure),
        (error) => {
          recoveredWith = error;
        },
        (message) => reported.push(message),
      ),
    );

    assert.equal(recoveredWith, failure);
    assert.deepEqual(reported, ["[api] redis subscribe failed; will retry: redis unavailable"]);
  });

  it("also contains a synchronous client failure", async () => {
    let recoveryCalls = 0;

    await assert.doesNotReject(() =>
      settleSubscription(
        () => {
          throw new Error("invalid subscriber configuration");
        },
        () => {
          recoveryCalls += 1;
        },
        () => undefined,
      ),
    );

    assert.equal(recoveryCalls, 1);
  });
});
