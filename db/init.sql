-- Prototype schema. Production would partition this table hourly and drop
-- old partitions for O(1) 24h retention; at demo scale a single table with
-- a periodic DELETE is a fine stand-in and uses the same indexes either way.
--
-- kafka_partition/kafka_offset give every row a natural, transport-level
-- identity and a UNIQUE constraint on them makes inserts idempotent: Kafka
-- only promises at-least-once delivery to this consumer (offsets are
-- committed after the write, not before), so a crash between "insert
-- succeeded" and "offset committed" replays the batch on restart. Without
-- this constraint that replay silently duplicates every row in it.
CREATE TABLE tx_events (
  id              BIGSERIAL PRIMARY KEY,
  event_ts        TIMESTAMPTZ NOT NULL,
  tenant_id       TEXT NOT NULL,
  eft_vendor      TEXT NOT NULL,
  message_type    TEXT NOT NULL,
  tx_family       TEXT,
  outcome_code    TEXT NOT NULL,
  source_system   TEXT NOT NULL,
  amount_cents    BIGINT,
  latency_ms      INTEGER NOT NULL,
  kafka_partition INTEGER NOT NULL,
  kafka_offset    BIGINT NOT NULL,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kafka_partition, kafka_offset)
);

CREATE INDEX idx_tx_events_ts         ON tx_events (event_ts DESC);
CREATE INDEX idx_tx_events_tenant_ts  ON tx_events (tenant_id, event_ts DESC);
CREATE INDEX idx_tx_events_vendor_ts  ON tx_events (eft_vendor, event_ts DESC);
CREATE INDEX idx_tx_events_outcome_ts ON tx_events (outcome_code, event_ts DESC);
CREATE INDEX idx_tx_events_msgtype_ts ON tx_events (message_type, event_ts DESC);
