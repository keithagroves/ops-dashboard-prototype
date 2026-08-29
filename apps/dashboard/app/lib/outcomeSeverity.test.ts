import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OUTCOME_CODES, outcomesOfSeverity } from "@nymbus/shared";
import { severityOf } from "./outcomeSeverity";

describe("outcomesOfSeverity", () => {
  it("partitions every outcome code into exactly one band", () => {
    // A code missing from every band would be unreachable from the severity
    // control; one in two bands would make the control's state ambiguous.
    const banded = [
      ...outcomesOfSeverity("approved"),
      ...outcomesOfSeverity("soft_decline"),
      ...outcomesOfSeverity("hard_decline"),
    ];
    assert.equal(banded.length, OUTCOME_CODES.length);
    assert.deepEqual([...banded].sort(), [...OUTCOME_CODES].sort());
  });

  it("classifies customer-side declines as soft and system-side as hard", () => {
    assert.deepEqual(outcomesOfSeverity("approved"), ["approved"]);
    assert.deepEqual(outcomesOfSeverity("soft_decline"), ["insufficient_funds", "exceeds_limit"]);
    assert.deepEqual(outcomesOfSeverity("hard_decline"), [
      "do_not_honor",
      "invalid_card",
      "format_error",
      "issuer_unavailable",
    ]);
  });
});

describe("severityOf", () => {
  it("recognises a selection that is exactly one band", () => {
    assert.equal(severityOf(outcomesOfSeverity("soft_decline")), "soft_decline");
    assert.equal(severityOf(outcomesOfSeverity("hard_decline")), "hard_decline");
    assert.equal(severityOf(["approved"]), "approved");
  });

  it("is order-independent", () => {
    assert.equal(severityOf(["exceeds_limit", "insufficient_funds"]), "soft_decline");
  });

  it("returns null for no selection", () => {
    assert.equal(severityOf(undefined), null);
    assert.equal(severityOf([]), null);
  });

  it("returns null for a strict subset of a band", () => {
    // Clicking one bar in the outcome chart lands here. The control shows
    // "All" rather than claiming a band that is not actually selected.
    assert.equal(severityOf(["insufficient_funds"]), null);
  });

  it("returns null for a selection spanning two bands", () => {
    assert.equal(severityOf(["approved", "do_not_honor"]), null);
  });
});
