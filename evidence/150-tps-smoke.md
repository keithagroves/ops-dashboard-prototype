# 150 TPS End-to-End Smoke — 2026-08-29

## Purpose

Validate that the prototype's real local path—not only its traffic-selection
helper—can sustain the production peak rate for a short demonstration:

`Generator → Kafka → Consumer → PostgreSQL → API`

This is representative-load smoke evidence, not a substitute for the planned
24-hour production soak.

## Setup

- Existing healthy Docker Kafka, PostgreSQL, and Redis services
- Existing Consumer and API processes
- Existing normal demo Generator left running
- An additional isolated Generator started with:

```bash
TPS=150 METRICS_PORT=9465 npm run dev -w services/generator
```

Using a separate metrics port made the load Generator's sent/drop counts
independent of the normal demo traffic. API samples were spaced 450ms apart so
the 400ms result cache did not turn the measurement into cache-hit latency.

## Result

| Signal | Observed |
|---|---:|
| Run duration | approximately 75 seconds |
| Kafka-acknowledged events | 11,245 |
| Effective acknowledged rate | 149.9 TPS |
| Dropped events | 0 |
| In-flight sends at sampled endpoint | 0 |
| API query samples | 7 |
| API query p50 | 23.1ms |
| API query p95 / maximum | 51.4ms |
| Returned global result | 50 tenants, 50 drill-down rows, 61 trend buckets |
| Kafka consumer lag during/after run | 2 / 1 messages |

The normal Generator continued publishing after the load Generator stopped,
so a point-in-time lag of one message is the steady moving edge rather than an
undrained load-test backlog.

## Defect found and fixed during the run

The first attempt exposed that Node truncates fractional `setInterval` delays.
At 150 TPS, `1000 / 150` became an effective 6ms timer and produced roughly
162 TPS instead of the configured rate. The Generator now uses a deadline-based
pacer that carries fractional milliseconds forward, alternates integer timer
delays naturally, and skips catch-up bursts after an event-loop stall.

`services/generator/src/pacer.test.ts` deterministically verifies that 150
events span 1000–1001ms even when the underlying timer has integer-millisecond
resolution.

## Remaining production validation

- Sustain 100–150 TPS for 24 hours.
- Populate a genuine 24-hour query window and record query percentiles under
  concurrent dashboard users.
- Validate 48-hour raw retention or equivalent rollups for prior-period
  comparison.
- Capture database growth, Kafka lag distribution, reconnect behavior, and
  service-level objectives throughout the soak.
