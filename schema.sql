CREATE TABLE IF NOT EXISTS enterprise_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sector TEXT NOT NULL,
  title TEXT,
  payload TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_records_tenant_sector
  ON enterprise_records (tenant_id, sector, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  payload TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
