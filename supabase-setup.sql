-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS candles (
  id bigserial PRIMARY KEY,
  symbol text NOT NULL,
  resolution text NOT NULL DEFAULT 'D',
  timestamp timestamptz NOT NULL,
  open numeric NOT NULL,
  high numeric NOT NULL,
  low numeric NOT NULL,
  close numeric NOT NULL,
  volume bigint DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (symbol, resolution, timestamp)
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_candles_symbol_res_ts
  ON candles (symbol, resolution, timestamp DESC);
