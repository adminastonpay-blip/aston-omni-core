-- ASTON OS Extreme 8.0.0 schema

CREATE TABLE IF NOT EXISTS enterprise_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sector TEXT NOT NULL,
  title TEXT,
  payload TEXT,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_records_tenant_sector
  ON enterprise_records (tenant_id, sector, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_active
  ON enterprise_records (tenant_id, sector) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant
  ON ledger_transactions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  payload TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  detail TEXT,
  request_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant
  ON audit_log (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER DEFAULT 0,
  ai_calls INTEGER DEFAULT 0,
  ingest_packets INTEGER DEFAULT 0,
  ledger_txs INTEGER DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);
