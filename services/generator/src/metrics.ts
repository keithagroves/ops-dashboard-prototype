import { createServer, type Server } from "node:http";

export interface GeneratorMetricsSnapshot {
  sent: number;
  dropped: number;
  inFlight: number;
}

export function renderMetrics(snapshot: GeneratorMetricsSnapshot): string {
  return [
    "# HELP nymbus_generator_events_sent_total Events acknowledged by Kafka.",
    "# TYPE nymbus_generator_events_sent_total counter",
    `nymbus_generator_events_sent_total ${snapshot.sent}`,
    "# HELP nymbus_generator_events_dropped_total Events dropped before Kafka acknowledgement.",
    "# TYPE nymbus_generator_events_dropped_total counter",
    `nymbus_generator_events_dropped_total ${snapshot.dropped}`,
    "# HELP nymbus_generator_kafka_sends_in_flight Current unresolved Kafka sends.",
    "# TYPE nymbus_generator_kafka_sends_in_flight gauge",
    `nymbus_generator_kafka_sends_in_flight ${snapshot.inFlight}`,
    "",
  ].join("\n");
}

export function startMetricsServer(
  snapshot: () => GeneratorMetricsSnapshot,
  port: number,
  host = "0.0.0.0",
): Server {
  const server = createServer((request, response) => {
    if (request.url !== "/metrics") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    response.end(renderMetrics(snapshot()));
  });
  server.on("error", (error) => {
    // Metrics visibility must never become a dependency of traffic capture.
    console.error(`[generator] metrics server error: ${error.message}`);
  });
  server.listen(port, host, () => {
    console.log(`[generator] metrics listening on :${port}/metrics`);
  });
  return server;
}
