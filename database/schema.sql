PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  position_title TEXT NOT NULL DEFAULT 'Менеджер по продажам',
  salary REAL NOT NULL DEFAULT 0 CHECK (salary >= 0),
  base_rate REAL NOT NULL DEFAULT 5 CHECK (base_rate >= 0),
  min_coef REAL NOT NULL DEFAULT 1.2 CHECK (min_coef >= 1),
  target_coef REAL NOT NULL DEFAULT 1.5 CHECK (target_coef >= 1),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  lead_date TEXT,
  client_name TEXT NOT NULL,
  phone TEXT,
  telegram TEXT,
  income TEXT,
  request TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'in_work', 'offer_sent', 'won', 'lost')),
  source_status TEXT,
  tariff TEXT,
  amount REAL CHECK (amount IS NULL OR amount >= 0),
  net_amount REAL CHECK (net_amount IS NULL OR net_amount >= 0),
  payment_method TEXT,
  payment_date TEXT,
  comment TEXT,
  next_action TEXT,
  manager_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'google_sheets')),
  telegram_chat_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sheet_lead_imports (
  row_hash TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Единая переписка менеджера с клиентом через Telegram-бота.
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  manager_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('manager', 'client', 'system')),
  body TEXT,
  attachment_file_id TEXT,
  attachment_file_name TEXT,
  attachment_mime TEXT,
  telegram_message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS telegram_notification_outbox (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Счета на оплату, выставляемые клиенту (PDF генерируется на лету из этих полей).
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  manager_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  client_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'failed')),
  telegram_message_id INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_no INTEGER,
  client_name TEXT NOT NULL,
  contact TEXT,
  tariff TEXT,
  revenue REAL NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  net_profit REAL NOT NULL DEFAULT 0 CHECK (net_profit >= 0),
  receivable REAL CHECK (receivable IS NULL OR receivable >= 0),
  payment_method TEXT,
  payment_date TEXT NOT NULL DEFAULT (date('now')),
  manager_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
  lead_id TEXT UNIQUE REFERENCES leads(id) ON DELETE SET NULL,
  schedule_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (substr(period, 9, 2) = '01'),
  employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
  plan_min REAL NOT NULL DEFAULT 0 CHECK (plan_min >= 0),
  plan_target REAL NOT NULL DEFAULT 0 CHECK (plan_target >= plan_min),
  plan_max REAL NOT NULL DEFAULT 0 CHECK (plan_max >= plan_target),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS employee_terms (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (substr(period, 9, 2) = '01'),
  salary REAL NOT NULL DEFAULT 0 CHECK (salary >= 0),
  base_rate REAL NOT NULL DEFAULT 5 CHECK (base_rate >= 0),
  min_coef REAL NOT NULL DEFAULT 1.2 CHECK (min_coef >= 1),
  target_coef REAL NOT NULL DEFAULT 1.5 CHECK (target_coef >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (employee_id, period)
);

CREATE UNIQUE INDEX IF NOT EXISTS plans_employee_period_uidx
  ON plans(period, employee_id) WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_team_period_uidx
  ON plans(period) WHERE employee_id IS NULL;
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS employees_user_idx ON employees(user_id);
CREATE INDEX IF NOT EXISTS leads_manager_status_idx ON leads(manager_id, status, position);
CREATE INDEX IF NOT EXISTS leads_date_idx ON leads(lead_date);
CREATE INDEX IF NOT EXISTS telegram_notification_pending_idx
  ON telegram_notification_outbox(sent_at, created_at);
CREATE INDEX IF NOT EXISTS messages_lead_idx ON messages(lead_id, created_at);
CREATE INDEX IF NOT EXISTS messages_manager_idx ON messages(manager_id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_uidx ON invoices(number);
CREATE INDEX IF NOT EXISTS invoices_lead_idx ON invoices(lead_id, created_at);
CREATE INDEX IF NOT EXISTS invoices_manager_idx ON invoices(manager_id);
CREATE INDEX IF NOT EXISTS payments_manager_date_idx ON payments(manager_id, payment_date);
CREATE INDEX IF NOT EXISTS payments_lead_idx ON payments(lead_id);
CREATE INDEX IF NOT EXISTS plans_period_idx ON plans(period);
CREATE INDEX IF NOT EXISTS employee_terms_period_idx ON employee_terms(employee_id, period);

CREATE TRIGGER IF NOT EXISTS employees_set_updated_at
AFTER UPDATE ON employees
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE employees
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS leads_set_updated_at
AFTER UPDATE ON leads
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE leads
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
