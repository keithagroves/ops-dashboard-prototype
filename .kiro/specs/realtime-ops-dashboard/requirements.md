# Requirements Document

## Introduction

The Nymbus Real-Time Ops Dashboard provides near-real-time operational visibility into a multi-tenant payment processing platform. The platform authorizes debit card transactions via ISO 8583 messages carried over persistent TCP connections from external EFT vendors. Before this feature, operations teams had only point-in-time counters with no time-series view, no trend watching, and no ability to slice metrics by meaningful attributes.

The dashboard delivers a rolling time-window view of transaction activity — volume trends, outcome distributions, latency percentiles, and a filterable transaction drill-down — to two audiences: tenant operations teams (scoped to a single institution) and Nymbus global ops (platform-wide view across all tenants). The pipeline captures metrics without touching the latency-sensitive authorization path.

**Production scope:** The target capability is a rolling 24-hour view, refreshing a few seconds behind live, with filtering and drill-down. All real-time transaction data is served from Nymbus-controlled infrastructure only — no external SaaS.

**Prototype scope:** This document describes the working prototype, which compresses the 24-hour window to 5–30 minute windows to make the pipeline visibly live during a short demonstration. Several production-hardening behaviors (retry caps, Redis reconnect limits, strict enum validation) are noted as goals but are not implemented in the prototype. The prototype is not intended to be production-ready or feature-complete; it demonstrates and validates the architecture.

**Out of scope:** Historical data beyond 24 hours flows to the existing OpenTelemetry/Grafana pipeline. The dashboard is read-only — no action or approval flows are in scope.

## Glossary

- **Connector**: The component that interfaces with EFT vendors, drives transaction processing, and returns authorization responses. Every transaction passes through it and it is the instrumentation point for metrics capture.
- **Generator**: Prototype component that simulates Connector traffic by producing synthetic ISO 8583-style transaction events to Kafka at a configurable rate.
- **Consumer**: Service that reads transaction events from Kafka in batches, writes them to Postgres, and signals connected API instances via Redis pub/sub.
- **API**: Fastify HTTP service that queries Postgres and streams results to dashboard clients over Server-Sent Events.
- **Dashboard**: Next.js/React single-page application that presents filterable, live-updating transaction analytics to operations users.
- **TxEvent**: A single transaction event record containing all attributes captured at processing time (see data model).
- **Tenant**: An issuing bank or financial institution that is a Nymbus client. Identified by a `tenant_id` string. Up to 50 tenants are supported.
- **Global_Ops**: A Nymbus-internal operations role with visibility across all tenants.
- **Tenant_Admin**: An operations role scoped to a single tenant's data.
- **EFT_Vendor**: An external funds-transfer network that sends ISO 8583 messages to the platform.
- **tx_events**: The Postgres table that is the single source of truth for all transaction metrics.
- **REDIS_UPDATE_CHANNEL**: The Redis pub/sub channel (`tx:updates`) used to broadcast "new data written" signals across API instances.
- **SSE**: Server-Sent Events — the HTTP streaming mechanism used to push query results from the API to browser clients.
- **FilterBar**: Dashboard component that exposes all filter dimensions to the user and controls the active `QueryFilters` state.
- **TrendChart**: Dashboard component that displays transaction volume over time as a time-bucketed line chart.
- **OutcomeBreakdown**: Dashboard component that displays a distribution of transaction outcome codes.
- **LatencyPanel**: Dashboard component that displays p50 and p95 latency statistics.
- **DrilldownTable**: Dashboard component that displays paginated raw transaction rows with all fields.
- **QueryFilters**: The set of filter parameters (`role`, `tenantId`, `eftVendor`, `messageType`, `txFamily`, `outcomeCode`, `sourceSystem`, `windowMinutes`) that scope a query or SSE stream.
- **WindowMinutes**: The rolling look-back window applied to all queries. Supported values: 5, 15, or 30 minutes.
- **BucketSeconds**: The time-bucket width used for trend aggregation, derived from WindowMinutes: 5 s (≤5 min window), 15 s (≤30 min window), 60 s (>30 min window).
- **DemoWindowCompression**: The prototype compresses the production rolling 24-hour view to 5–30 minute windows to make the pipeline visibly live during a short demonstration. The bucketing and query mechanics are identical at either scale.

---

## Requirements

### Requirement 1: Fire-and-Forget Metrics Capture

**User Story:** As a platform architect, I want metrics capture to be fully decoupled from the authorization hot path, so that a metrics subsystem failure or slowdown never affects transaction processing latency.

#### Acceptance Criteria

1. THE Generator SHALL emit transaction events to Kafka without awaiting the produce call's resolution.
2. IF a Kafka produce call fails, THEN THE Generator SHALL increment an in-memory dropped-event counter by 1 and continue processing the next transaction without propagating the error to the caller.
3. THE Generator SHALL produce each event to the `tx-events` Kafka topic with the `tenant_id` as the message key.
4. WHILE a transaction event is being produced to Kafka, THE Generator SHALL not block or delay any subsequent transaction processing.
5. IF the Kafka broker is unreachable at the time of a produce call, THEN THE Generator SHALL treat the event as dropped, increment the dropped-event counter by 1, and return the authorization result to the caller within the same latency budget as a successful produce.
6. WHEN the dropped-event counter is incremented, THE Generator SHALL expose the current counter value through its existing metrics interface so that the count is observable without restarting the service.
7. THE Generator SHALL be capable of sustaining a configurable event rate up to 150 transactions per second across up to 50 simulated tenants and 5 EFT vendors, matching the production platform's peak load profile.
8. THE Generator SHALL distribute traffic non-uniformly: the hottest 10% of tenants SHALL receive approximately 60% of total traffic, simulating the production pattern where the busiest clients generate ~15 TPS against a ~2 TPS baseline for others.

---

### Requirement 2: Transaction Event Data Model

**User Story:** As an operations engineer, I want each captured event to carry a complete, structured set of attributes, so that I can filter and drill down across every meaningful dimension of a transaction.

#### Acceptance Criteria

1. THE tx_events table SHALL store the following fields per event: `id` (bigserial, primary key, unique, NOT NULL), `event_ts` (timestamptz, NOT NULL), `tenant_id` (text, NOT NULL), `eft_vendor` (text, NOT NULL), `message_type` (text, NOT NULL), `tx_family` (text, nullable), `outcome_code` (text, NOT NULL), `source_system` (text, NOT NULL), `amount_cents` (bigint, nullable), `latency_ms` (integer, NOT NULL), `ingested_at` (timestamptz, NOT NULL, default now()).
2. THE tx_events table SHALL support the following `message_type` values: `auth_request`, `reversal`, `advice`, `network_management`.
3. THE tx_events table SHALL support the following non-null `tx_family` values: `purchase`, `withdrawal`, `deposit`, `transfer`, `payment`.
4. IF a row has `message_type` other than `auth_request`, THEN the `tx_family` field SHALL be null.
5. THE tx_events table SHALL support the following `outcome_code` values: `approved`, `insufficient_funds`, `exceeds_limit`, `do_not_honor`, `invalid_card`, `format_error`, `issuer_unavailable`.
6. THE tx_events table SHALL support `eft_vendor` values: `vendor-a`, `vendor-b`, `vendor-c`, `vendor-d`, `vendor-e`.
7. THE tx_events table SHALL have indexes on (`event_ts DESC`), (`tenant_id`, `event_ts DESC`), (`eft_vendor`, `event_ts DESC`), (`outcome_code`, `event_ts DESC`), and (`message_type`, `event_ts DESC`).

---

### Requirement 3: Batched Event Ingestion

**User Story:** As a platform operator, I want transaction events written to Postgres in batches, so that the database write volume stays manageable at sustained high throughput.

#### Acceptance Criteria

1. THE Consumer SHALL read transaction events from Kafka using batch-oriented consumption (`eachBatch`).
2. THE Consumer SHALL insert each Kafka batch into the `tx_events` table as a single multi-row `INSERT` statement, inserting a maximum of 1000 messages per batch.
3. WHEN a Consumer instance restarts after a crash, THE Consumer SHALL resume from the last committed Kafka offset so that no events in the batch are lost and no events are duplicated.
4. WHEN a Kafka batch is successfully inserted into the `tx_events` table, THE Consumer SHALL commit the Kafka offset for that batch.
5. IF a Kafka message cannot be parsed as a valid TxEvent, THEN THE Consumer SHALL skip that message, log a record of the skipped message including its Kafka topic, partition, and offset, and continue processing the remainder of the batch.

---

### Requirement 4: Cross-Instance Pub/Sub Fan-Out

**User Story:** As a platform operator, I want all horizontally-scaled API instances to receive notification when new data is written, so that every connected dashboard client is updated regardless of which API pod it is connected to.

#### Acceptance Criteria

1. WHEN the Consumer completes a successful batch insert into Postgres, THE Consumer SHALL publish a signal to the `tx:updates` Redis channel within 500 milliseconds of the insert commit.
2. IF the Consumer fails to publish to the `tx:updates` Redis channel after 3 attempts, THEN THE Consumer SHALL log an error indicating the publish failure and discard the publish attempt without affecting the completed batch insert.
3. THE API SHALL maintain exactly one Redis subscriber connection per process instance, shared across all active SSE client connections on that instance.
4. WHEN the `tx:updates` channel receives a publish, THE API SHALL trigger a re-query for every active SSE client connected to that instance within 1 second of receiving the publish signal.
5. IF the re-query for an SSE client fails, THEN THE API SHALL retain that client's existing data state and send an error event to that client indicating the update could not be retrieved.

---

### Requirement 5: Tenant-Scoped Query Enforcement

**User Story:** As a security-conscious architect, I want tenant data isolation enforced at the query layer, so that a Tenant_Admin can never access data belonging to another tenant regardless of request parameters.

#### Acceptance Criteria

1. WHEN a request arrives with `role=tenant`, THE API SHALL require a non-empty `tenantId` parameter and SHALL append a tenant equality filter on every query using the provided `tenantId` value, such that no query executes without that filter present.
2. IF a request has `role=tenant` and the `tenantId` parameter is absent or empty, THEN THE API SHALL reject the request with a 400 error response indicating the missing tenant identifier, and SHALL not execute any query.
3. WHEN a request arrives with `role=global` and no `tenantId` parameter is present, THE API SHALL execute the query without any tenant filter applied.
4. WHEN a request arrives with `role=global` and an optional `tenantId` parameter is present and non-empty, THE API SHALL apply a tenant equality filter on every query using that `tenantId` value as a drill-down constraint.
5. THE API SHALL enforce tenant scoping on both the `/api/query` snapshot route and the `/api/stream` SSE route using the same filter-building logic, such that a filter applied on one route is identically applied on the other route for equivalent request parameters.

---

### Requirement 6: Filterable Query Engine

**User Story:** As an operations engineer, I want to filter all dashboard views by any combination of transaction attributes, so that I can isolate and investigate activity for a specific subset of traffic.

#### Acceptance Criteria

1. THE API SHALL accept the following optional filter parameters on both routes: `tenantId`, `eftVendor`, `messageType`, `txFamily`, `outcomeCode`, `sourceSystem`, `windowMinutes`.
2. WHEN one or more optional filter parameters are provided, THE API SHALL apply each as an equality condition joined by `AND` in the query `WHERE` clause.
3. WHEN no filter parameters other than `windowMinutes` are provided, THE API SHALL return results for all records within the active time window without restricting by any attribute.
4. THE API SHALL scope all queries to a rolling time window ending at the time of the request and beginning `windowMinutes` minutes prior, defaulting to 15 minutes when `windowMinutes` is not specified.
5. THE prototype SHALL support `windowMinutes` values of 5, 15, and 30, representing a compressed stand-in for the production rolling 24-hour window; the bucketing and query mechanics are identical at either scale.

---

### Requirement 7: Query Result Shape

**User Story:** As a dashboard developer, I want a single API response to carry all the data needed to render all four dashboard panels, so that the dashboard makes one round-trip per update cycle rather than one per panel.

#### Acceptance Criteria

1. THE API SHALL return a single `QueryResult` object containing: `trend` (array of `{bucket: ISO 8601 UTC timestamp, count: non-negative integer}` time-series points), `outcomes` (array of `{outcomeCode, count: non-negative integer}` outcome distribution points), `latency` (`{p50, p95}` in milliseconds rounded to two decimal places, nullable when no data), `rows` (up to 50 most-recent raw `DrilldownRow` records ordered by `event_ts DESC`), and `totalCount` (non-negative integer total matching row count for the active filters).
2. WHEN computing trend data, THE API SHALL bucket events using `BucketSeconds` derived from the active `WindowMinutes`: 5 seconds for windows ≤5 minutes, 15 seconds for windows ≤30 minutes, and 60 seconds for windows >30 minutes; buckets with no matching events within the active window SHALL still appear in the `trend` array with a count of 0.
3. THE API SHALL compute latency statistics using `percentile_cont(0.5)` for p50 and `percentile_cont(0.95)` for p95 across all `latency_ms` values matching the active filters.
4. THE API SHALL return `outcomes` ordered by count descending; WHERE two outcome codes have equal counts, they SHALL be ordered by `outcomeCode` ascending.
5. WHEN no rows match the active filters, THE API SHALL return `latency` as `{p50: null, p95: null}`, `trend` as an empty array, `outcomes` as an empty array, `rows` as an empty array, and `totalCount` as 0.
6. IF any component of the `QueryResult` (trend, outcomes, latency, rows) cannot be computed due to a server-side error, THEN THE API SHALL fail the entire response atomically and return an error response rather than a partially populated `QueryResult`.

---

### Requirement 8: SSE Streaming Route

**User Story:** As a dashboard user, I want the dashboard to receive pushed updates automatically when new transactions arrive, so that I see live data without manually refreshing.

#### Acceptance Criteria

1. THE API SHALL expose a `/api/stream` route that responds with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive` headers and keeps the HTTP connection open.
2. WHEN a client connects to `/api/stream`, THE API SHALL validate the provided filters and immediately execute a query and emit the result as the first SSE `data:` frame within 2 seconds.
3. IF the provided filters are invalid or missing required fields at connection time, THEN THE API SHALL emit an SSE `event: error` frame with a JSON payload indicating the validation failure and close the connection.
4. WHEN THE API receives a `tx:updates` Redis notification, THE API SHALL re-execute the query and emit a new SSE `data:` frame to all active stream clients on that instance, subject to the minimum push interval defined in criterion 5.
5. THE API SHALL enforce a minimum push interval of 500 milliseconds between successive SSE frames emitted to a single client; IF a `tx:updates` notification arrives within 500 milliseconds of the last emission, THE API SHALL defer the emission until the 500-millisecond interval has elapsed.
6. THE API SHALL emit a keep-alive SSE comment (`: keep-alive`) every 15 seconds of client inactivity to prevent proxy and browser connection timeouts.
7. WHEN a client disconnects from the SSE stream, THE API SHALL unsubscribe the associated Redis update listener and release all associated resources within 5 seconds of disconnect detection.
8. WHEN an error occurs during query execution on the stream route, THE API SHALL emit an SSE `event: error` frame with a JSON payload indicating the nature of the failure and continue listening for subsequent `tx:updates` notifications without closing the connection.

---

### Requirement 9: Snapshot Query Route

**User Story:** As a dashboard developer, I want a one-shot query endpoint, so that I can retrieve a point-in-time snapshot of current metrics without establishing a streaming connection.

#### Acceptance Criteria

1. THE API SHALL expose a `/api/query` route that accepts filter parameters as URL query string parameters, executes the query for those filters, and returns the `QueryResult` as a JSON response.
2. IF the provided filter parameters are invalid (e.g., `role=tenant` without `tenantId`), THEN THE API SHALL return HTTP 400 with a JSON response body containing an error message indicating the validation failure.
3. IF the query cannot be executed due to a server-side error, THEN THE API SHALL return HTTP 500 with a JSON response body containing an error message indicating the failure.

---

### Requirement 10: Dashboard Live Connection Management

**User Story:** As a dashboard user, I want the dashboard to automatically reconnect and reflect my current filter selections, so that I always see a live, accurately-scoped view without manual intervention.

#### Acceptance Criteria

1. WHEN the page loads, THE Dashboard SHALL establish an SSE connection to `/api/stream` with the current `QueryFilters` serialized as query parameters within 2 seconds.
2. WHEN the active `QueryFilters` change, THE Dashboard SHALL close the existing SSE connection and open a new one with the updated parameters within 500 milliseconds of the filter change.
3. THE Dashboard SHALL display a live connection status indicator that is visually distinct in its connected state when the SSE connection is open and in its disconnected state when the SSE connection is closed or has failed.
4. WHEN an SSE `data:` frame arrives, THE Dashboard SHALL parse the payload as a `QueryResult` and update all four panel components within 200 milliseconds without triggering a full page re-render.
5. IF an SSE `data:` frame payload cannot be parsed as a valid `QueryResult`, THEN THE Dashboard SHALL retain the last successfully rendered panel state and display an error indicator without disrupting the live SSE connection.
6. WHEN no `QueryResult` data has been received from the SSE stream since the connection was established, THE Dashboard SHALL display a loading state in place of the four panel components.

---

### Requirement 11: Filter Bar

**User Story:** As an operations engineer, I want a persistent filter bar with controls for every filter dimension, so that I can quickly scope the dashboard view to the traffic I care about.

#### Acceptance Criteria

1. THE FilterBar SHALL render controls for: audience toggle (Tenant view / Global ops view), tenant selector, EFT vendor selector, message type selector, transaction family selector, outcome code selector, and time window selector.
2. WHEN the audience is set to "Tenant view", THE FilterBar SHALL require a `tenantId` selection and SHALL default to the first tenant in the ordered list (`tenant-01`) if none is set.
3. WHEN the audience is set to "Global ops view", THE FilterBar SHALL offer an optional tenant drill-down selector with an "All tenants" default option.
4. THE FilterBar SHALL render tenant options for all 50 tenants (`tenant-01` through `tenant-50`).
5. THE FilterBar SHALL render time window options for exactly three durations: 5 minutes, 15 minutes, and 30 minutes, and SHALL default to the 15-minute window on initial load.
6. THE FilterBar SHALL display the live connection status indicator as one of two discrete states: "connected" or "disconnected".
7. WHEN any filter control value changes, THE FilterBar SHALL apply the updated filter to the dashboard view within 500 milliseconds without requiring a manual submit action.
8. IF a required filter value is absent when the FilterBar initialises, THEN THE FilterBar SHALL apply the documented default value for that filter before rendering any dashboard data.

---

### Requirement 12: Transaction Volume Trend Chart

**User Story:** As an operations engineer, I want to see transaction volume plotted over time, so that I can identify spikes, drops, or patterns in activity within the selected window.

#### Acceptance Criteria

1. THE TrendChart SHALL render a time-series line chart using the `trend` array from the most-recently-received `QueryResult`.
2. WHEN the `trend` array is non-empty, THE TrendChart SHALL display one data point per time bucket with the bucket timestamp on the x-axis and transaction count on the y-axis, where the x-axis labels reflect the selected time window's granularity (minutes for windows up to 1 hour, hours for windows up to 7 days, days for windows beyond 7 days).
3. IF the `trend` array is empty or absent, THEN THE TrendChart SHALL display an empty state message indicating no data is available for the selected time window.
4. WHEN a new `QueryResult` is received, THE TrendChart SHALL replace the previously rendered data with the data from the new result within 500 milliseconds.
5. IF a data point's transaction count exceeds the y-axis maximum of the current render, THEN THE TrendChart SHALL automatically rescale the y-axis to accommodate the new maximum value, with the y-axis always starting at 0.

---

### Requirement 13: Outcome Code Distribution

**User Story:** As an operations engineer, I want to see the breakdown of transaction outcomes, so that I can immediately spot deteriorating approval rates or elevated error conditions.

#### Acceptance Criteria

1. THE OutcomeBreakdown SHALL render a chart of `outcome_code` values, where each distinct code from the `outcomes` array of the most-recently-received `QueryResult` is represented as a discrete segment showing its count and percentage of the total.
2. WHEN an outcome code is selected in the OutcomeBreakdown, THE Dashboard SHALL update the active `QueryFilters` to filter the entire dashboard view to that outcome code and SHALL visually distinguish the selected segment from all other segments.
3. WHEN an already-selected outcome code is selected again, THE Dashboard SHALL remove only the outcome code filter from the active `QueryFilters` and restore the dashboard view to the state governed by the remaining active filters.
4. IF the `outcomes` array in the most-recently-received `QueryResult` is empty or absent, THEN THE OutcomeBreakdown SHALL display a message indicating no outcome data is available and SHALL NOT render any chart segments.

---

### Requirement 14: Latency Panel

**User Story:** As an operations engineer, I want to see p50 and p95 processing latency alongside a total transaction count, so that I can quickly gauge whether end-to-end performance is within acceptable bounds.

#### Acceptance Criteria

1. THE LatencyPanel SHALL display the `p50` and `p95` latency values (in milliseconds) from the `latency` field of the most-recently-received `QueryResult`.
2. THE LatencyPanel SHALL display the `totalCount` from the most-recently-received `QueryResult`.
3. WHEN `p50` or `p95` is `null` (no data), THE LatencyPanel SHALL display a "—" placeholder rather than a numeric value.
4. WHEN a new `QueryResult` is received, THE LatencyPanel SHALL replace all currently displayed values (p50, p95, totalCount) with the values from the new result.
5. WHEN no `QueryResult` has yet been received since the connection was established, THE LatencyPanel SHALL display a loading state in place of all three values.
6. WHEN `totalCount` is null or absent in the received `QueryResult`, THE LatencyPanel SHALL display a "—" placeholder in place of the count value.

---

### Requirement 15: Transaction Drill-Down Table

**User Story:** As an operations engineer, I want to see a table of recent individual transactions with all their attributes, so that I can inspect the specific events behind an anomaly in the summary panels.

#### Acceptance Criteria

1. THE DrilldownTable SHALL display up to 50 rows from the `rows` array of the most-recently-received `QueryResult`, ordered by event time descending (most-recent first).
2. THE DrilldownTable SHALL display the following columns per row in this order: event time, tenant, EFT vendor, message type, transaction family, outcome code, amount, and latency.
3. WHEN the `rows` array is empty or absent, THE DrilldownTable SHALL display a message indicating no data is available and render zero data rows.
4. WHEN `tx_family` is null, THE DrilldownTable SHALL display "—" in the transaction family column.
5. WHEN `amount_cents` is null, THE DrilldownTable SHALL display "—" in the amount column.
6. WHEN `amount_cents` is non-null, THE DrilldownTable SHALL display the value converted from cents to dollars, formatted with a leading "$" symbol and exactly two decimal places (e.g., 1250 → `$12.50`).
7. WHEN a row's `latency_ms` value is greater than 500, THE DrilldownTable SHALL render that row's latency cell with a distinct background or text color that differs from rows with `latency_ms` of 500 or below.
8. WHEN a row's `outcome_code` is exactly `approved`, THE DrilldownTable SHALL render that cell's text in green; IF a row's `outcome_code` is any value other than `approved`, THEN THE DrilldownTable SHALL render that cell's text in red.

---

### Requirement 16: Data Retention

**User Story:** As a platform operator, I want transaction event data to be automatically pruned after the retention window expires, so that storage usage remains bounded.

#### Acceptance Criteria

1. THE Consumer SHALL periodically delete all rows from `tx_events` where `event_ts` is older than the configured retention window; for the prototype the retention window is set to match the demo observation period (30 minutes or less); in production this window SHALL be set to 24 hours, beyond which data is the responsibility of the OpenTelemetry/Grafana pipeline.
2. THE Consumer SHALL execute the retention cleanup on an interval no longer than 30 seconds.
3. WHEN retention cleanup completes, THE Consumer SHALL log the number of rows removed, including zero if no rows qualified for deletion.
4. IF the retention cleanup operation fails, THEN THE Consumer SHALL log an error message indicating the failure and retry on the next scheduled interval without skipping subsequent cleanup cycles.

---

### Requirement 17: Multi-Instance Horizontal Scalability

**User Story:** As a platform operator, I want the API to scale horizontally across multiple instances without loss of dashboard liveness, so that EKS can add or remove pods without disrupting connected clients.

#### Acceptance Criteria

1. THE API SHALL maintain no per-SSE-client state that is shared across processes, such that terminating one API instance SHALL NOT affect SSE connections held by any other API instance.
2. THE API SHALL maintain exactly one shared Redis channel subscriber per process, regardless of the number of SSE clients connected to that process.
3. WHEN the Consumer publishes a batch notification to Redis, EACH API instance SHALL re-query Postgres and push the resulting update to its connected SSE clients within 2 seconds of the publish event.
4. WHEN a second API instance is started pointing at the same Postgres and Redis, THE Dashboard SHALL receive SSE events with identical batch payload content when connected to either instance, for the same batch written by the Consumer.
5. IF an API instance fails to re-query Postgres after receiving a Redis publish notification, THEN THE API instance SHALL push an error event to its connected SSE clients indicating the update could not be delivered, without terminating the SSE connection.

---

### Requirement 18: Incident Mode Simulation

**User Story:** As a demo operator, I want to trigger a simulated incident that spikes a specific outcome code for a specific tenant, so that the drill-down story has a real anomaly to find during a live demonstration.

#### Acceptance Criteria

1. WHERE incident mode is enabled (`INCIDENT_MODE=true`), THE Generator SHALL periodically introduce a spike of the configured `INCIDENT_OUTCOME` code for the tenant at index `INCIDENT_TENANT_INDEX`, repeating on a cycle of `INCIDENT_INTERVAL_SEC` seconds with each spike lasting `INCIDENT_DURATION_SEC` seconds.
2. WHILE an incident period is active for a tenant, THE Generator SHALL produce `auth_request` events for that tenant with the incident `outcomeCode` at 70% weight and `approved` at 30% weight, replacing the tenant's normal outcome distribution for the duration of the incident period.
3. WHEN an incident period ends, THE Generator SHALL log a clearance event identifying the affected tenant and the incident `outcomeCode`, and resume the tenant's normal outcome distribution for all subsequent events until the next incident period begins.
4. WHEN an incident period starts, THE Generator SHALL log a start event identifying the affected tenant index, the resolved tenant identifier, and the configured `outcomeCode`.
5. THE Generator SHALL treat `INCIDENT_INTERVAL_SEC`, `INCIDENT_DURATION_SEC`, `INCIDENT_TENANT_INDEX`, and `INCIDENT_OUTCOME` as required environment variables when `INCIDENT_MODE=true`; IF any of these variables is absent or invalid when `INCIDENT_MODE=true`, THEN THE Generator SHALL log an error indicating which variable is missing or invalid and exit without producing events.

### Requirement 19: No External Data Egress

**User Story:** As a platform operator, I want all real-time transaction data to remain within Nymbus-controlled infrastructure, so that customer transaction data is never transmitted to a third-party SaaS system for the real-time operational view.

#### Acceptance Criteria

1. THE system SHALL NOT transmit raw transaction events, aggregated metrics, or any derivative of transaction data to any external or third-party SaaS service (e.g., Datadog, Mixpanel, Grafana Cloud) for the purpose of serving the real-time dashboard view.
2. THE system SHALL serve all real-time dashboard queries from infrastructure owned and operated by Nymbus (PostgreSQL, Redis, and the API layer).
3. THE system SHALL delegate historical data beyond the 24-hour rolling window to the existing OpenTelemetry/Grafana pipeline; the real-time dashboard is explicitly out of scope for data older than 24 hours.
