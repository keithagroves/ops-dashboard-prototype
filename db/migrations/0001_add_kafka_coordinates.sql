-- Migration 0001: add the Kafka-coordinate idempotency columns to tx_events.
--
-- init.sql only runs when Postgres initializes an empty volume, so an
-- existing deployment upgrading from before this migration keeps the old
-- table shape - and the consumer, which now inserts kafka_partition/
-- kafka_offset on every row, would fail immediately. This migration brings
-- an existing tx_events up to the current shape.
--
-- tx_events is a rolling operational-metrics table with no
-- reconciliation/historical value (see README) - rows written before this
-- migration have no real Kafka coordinates to backfill, so upgrading
-- truncates the table rather than leaving pre-existing rows permanently
-- unprotected by the uniqueness constraint this migration adds. Safe to run
-- more than once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tx_events' AND column_name = 'kafka_partition'
  ) THEN
    TRUNCATE TABLE tx_events;
    ALTER TABLE tx_events ADD COLUMN kafka_partition INTEGER NOT NULL DEFAULT -1;
    ALTER TABLE tx_events ADD COLUMN kafka_offset BIGINT NOT NULL DEFAULT -1;
    ALTER TABLE tx_events ALTER COLUMN kafka_partition DROP DEFAULT;
    ALTER TABLE tx_events ALTER COLUMN kafka_offset DROP DEFAULT;
    ALTER TABLE tx_events ADD CONSTRAINT tx_events_kafka_coord_uniq UNIQUE (kafka_partition, kafka_offset);
  END IF;
END $$;
