import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EFT_VENDORS } from "@nymbus/shared";
import { createTenantPicker } from "./traffic";

function seededRandom(seed = 123456789): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("tenant traffic shaping", () => {
  it("supports the required 50 tenants and five EFT vendors", () => {
    const picker = createTenantPicker(50, 0.1, 0.6, seededRandom());
    assert.equal(picker.tenants.length, 50);
    assert.equal(picker.hotTenants.size, 5);
    assert.equal(EFT_VENDORS.length, 5);
  });

  it("sends approximately 60% of a representative sample to the hottest 10%", () => {
    const picker = createTenantPicker(50, 0.1, 0.6, seededRandom());
    const sampleSize = 150 * 60; // one minute at the required peak rate
    let hot = 0;
    for (let index = 0; index < sampleSize; index += 1) {
      if (picker.hotTenants.has(picker.pick())) hot += 1;
    }

    const ratio = hot / sampleSize;
    assert.ok(ratio >= 0.58 && ratio <= 0.62, `hot-tenant ratio was ${ratio}`);
  });

  it("remains valid for a one-tenant demo configuration", () => {
    const picker = createTenantPicker(1, 1, 0, seededRandom());
    assert.equal(picker.pick(), "tenant-01");
  });
});
