import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalRateOf } from "./stats";

describe("approvalRateOf", () => {
  it("computes approved as a share of all outcomes", () => {
    const rate = approvalRateOf([
      { outcomeCode: "approved", count: 90 },
      { outcomeCode: "insufficient_funds", count: 10 },
    ]);
    assert.equal(rate, 0.9);
  });

  it("returns null for an empty window rather than 0", () => {
    // 0% approval and "no traffic yet" mean very different things to an
    // operator, and a 0 here would render as a red-looking KPI on a quiet
    // tenant.
    assert.equal(approvalRateOf([]), null);
  });

  it("returns 0 when there is traffic but nothing was approved", () => {
    assert.equal(approvalRateOf([{ outcomeCode: "do_not_honor", count: 5 }]), 0);
  });

  it("returns 1 when everything was approved", () => {
    assert.equal(approvalRateOf([{ outcomeCode: "approved", count: 5 }]), 1);
  });

  it("handles zero-count entries without dividing by zero", () => {
    assert.equal(approvalRateOf([{ outcomeCode: "approved", count: 0 }]), null);
  });
});
