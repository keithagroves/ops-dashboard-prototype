-- Prototype schema. Production would partition this table hourly and drop
-- old partitions for O(1) 24h retention; at demo scale a single table with
-- a periodic DELETE is a fine stand-in and uses the same indexes either way.

CREATE TABLE tx_events (
  id            BIGSERIAL PRIMARY KEY,
  event_ts      TIMESTAMPTZ NOT NULL,
  tenant_id     TEXT NOT NULL,
  eft_vendor    TEXT NOT NULL,
  message_type  TEXT NOT NULL,
  tx_family     TEXT,
  outcome_code  TEXT NOT NULL,
  source_system TEXT NOT NULL,
  amount_cents  BIGINT,
  latency_ms    INTEGER NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tx_events_ts         ON tx_events (event_ts DESC);
CREATE INDEX idx_tx_events_tenant_ts  ON tx_events (tenant_id, event_ts DESC);
CREATE INDEX idx_tx_events_vendor_ts  ON tx_events (eft_vendor, event_ts DESC);
CREATE INDEX idx_tx_events_outcome_ts ON tx_events (outcome_code, event_ts DESC);
CREATE INDEX idx_tx_events_msgtype_ts ON tx_events (message_type, event_ts DESC);
