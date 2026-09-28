CREATE TABLE IF NOT EXISTS delivery_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  event_id uuid NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
  job jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','dispatched','processing','completed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_intents_dispatchable
  ON delivery_intents(state, available_at, dispatched_at, processing_at)
  WHERE state <> 'completed';

CREATE INDEX IF NOT EXISTS delivery_intents_event_created
  ON delivery_intents(event_id, created_at DESC);
