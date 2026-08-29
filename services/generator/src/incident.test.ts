import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIncidentController } from "./incident";

const settings = {
  enabled: true,
  tenantIndex: 2,
  tenantId: "tenant-03",
  outcomeCode: "issuer_unavailable" as const,
  intervalSec: 10,
  durationSec: 4,
};

describe("incident controller", () => {
  it("starts on the configured cycle and clears after the duration", () => {
    const controller = createIncidentController(settings, 1_000);

    assert.deepEqual(controller.tick(10_999), []);
    const started = controller.tick(11_000);
    assert.equal(started[0].type, "started");
    assert.equal(controller.current()?.tenantId, "tenant-03");
    assert.equal(controller.current()?.outcomeCode, "issuer_unavailable");

    assert.deepEqual(controller.tick(14_999), []);
    const cleared = controller.tick(15_000);
    assert.equal(cleared[0].type, "cleared");
    assert.equal(controller.current(), null);
  });

  it("repeats at the next configured interval", () => {
    const controller = createIncidentController(settings, 0);
    assert.equal(controller.tick(10_000)[0].type, "started");
    assert.equal(controller.tick(14_000)[0].type, "cleared");
    assert.equal(controller.tick(20_000)[0].type, "started");
  });

  it("does nothing when incident mode is disabled", () => {
    const controller = createIncidentController({ ...settings, enabled: false }, 0);
    assert.deepEqual(controller.tick(1_000_000), []);
    assert.equal(controller.current(), null);
  });
});
