import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMetrics } from "./metrics";

describe("renderMetrics", () => {
  it("exposes sent, dropped, and in-flight values in Prometheus text format", () => {
    const output = renderMetrics({ sent: 120, dropped: 3, inFlight: 7 });

    assert.match(output, /nymbus_generator_events_sent_total 120/);
    assert.match(output, /nymbus_generator_events_dropped_total 3/);
    assert.match(output, /nymbus_generator_kafka_sends_in_flight 7/);
  });
});
