import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "..");
const env = readEnv(resolve(root, ".env"));
const dbPath = resolve(root, process.env.SQLITE_DB_PATH || "data/pulse-crm.sqlite");
const force = process.argv.includes("--force");

if (existsSync(dbPath) && !force) {
  console.log(`SQLite database already exists: ${dbPath}`);
  console.log("Use --force only when you intentionally want to recreate it.");
  process.exit(0);
}

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(readFileSync(resolve(root, "database/schema.sql"), "utf8"));
migrateLeadsOrigin(db);

function migrateLeadsOrigin(database) {
  const columns = database.prepare("PRAGMA table_info(leads)").all();
  if (!columns.some((c) => c.name === "origin")) {
    database.exec(
      "ALTER TABLE leads ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'google_sheets'))",
    );
  }
}

if (force) {
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM payments;
    DELETE FROM leads;
    DELETE FROM employee_terms;
    DELETE FROM plans;
    DELETE FROM user_roles;
    DELETE FROM employees;
    DELETE FROM users;
  `);
}

let source;
try {
  source = await loadCurrentData(env);
  console.log("Imported current CRM data from the configured Supabase project.");
} catch (error) {
  console.warn(`Remote import was unavailable: ${error instanceof Error ? error.message : error}`);
  source = fallbackData();
  console.log("Created the database with local demo data.");
}

db.exec("BEGIN IMMEDIATE");
try {
  const passwords = new Map([
    ["vasya@crm.local", "Director2026!"],
    ["alina@crm.local", "Manager2026!"],
    ["pasha@crm.local", "Manager2026!"],
  ]);

  for (const employee of source.employees) {
    if (!employee.user_id || !employee.email) continue;
    const password = passwords.get(String(employee.email).toLowerCase()) ?? "Manager2026!";
    const salt = randomBytes(16).toString("hex");
    const passwordHash = scryptSync(password, salt, 64).toString("hex");
    db.prepare(`
      INSERT OR REPLACE INTO users
        (id, email, password_hash, password_salt, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(employee.user_id, employee.email, passwordHash, salt, employee.is_active ? 1 : 0);
  }

  insertRows(db, "employees", source.employees);
  insertRows(db, "user_roles", source.user_roles);
  insertRows(db, "leads", source.leads);
  insertRows(db, "payments", source.payments);
  insertRows(db, "plans", source.plans);
  insertRows(db, "employee_terms", source.employee_terms);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(`SQLite database ready: ${dbPath}`);
console.log(`Rows: ${Object.entries(source).map(([key, rows]) => `${key}=${rows.length}`).join(", ")}`);

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([^#=]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]),
  );
}

async function loadCurrentData(values) {
  const base = values.SUPABASE_URL;
  const apiKey = values.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !apiKey) throw new Error("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing");

  const authResponse = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ email: "vasya@crm.local", password: "Director2026!" }),
  });
  if (!authResponse.ok) throw new Error(`authentication failed (${authResponse.status})`);
  const auth = await authResponse.json();
  const headers = { apikey: apiKey, authorization: `Bearer ${auth.access_token}` };

  const tables = ["employees", "user_roles", "leads", "payments", "plans", "employee_terms"];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const response = await fetch(`${base}/rest/v1/${table}?select=*`, { headers });
      if (!response.ok) throw new Error(`${table} export failed (${response.status})`);
      return [table, await response.json()];
    }),
  );
  return Object.fromEntries(entries);
}

function insertRows(database, table, rows) {
  for (const row of rows) {
    const keys = Object.keys(row);
    const columns = keys.map((key) => `"${key}"`).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((key) => normalize(row[key]));
    database.prepare(`INSERT OR REPLACE INTO "${table}" (${columns}) VALUES (${placeholders})`).run(...values);
  }
}

function normalize(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function fallbackData() {
  const employees = [
    ["11111111-1111-1111-1111-111111111111", "Алина", "alina@crm.local", 60000, 5],
    ["22222222-2222-2222-2222-222222222222", "Паша", "pasha@crm.local", 60000, 5],
    ["33333333-3333-3333-3333-333333333333", "Вася", "vasya@crm.local", 100000, 3],
  ].map(([id, full_name, email, salary, base_rate]) => ({
    id,
    user_id: id,
    full_name,
    email,
    position_title: full_name === "Вася" ? "Руководитель отдела продаж" : "Менеджер по продажам",
    salary,
    base_rate,
    min_coef: 1.2,
    target_coef: 1.5,
    is_active: true,
    created_at: new Date().toISOString(),
  }));
  return {
    employees,
    user_roles: employees.map((employee) => ({
      id: randomUUID(),
      user_id: employee.user_id,
      role: employee.full_name === "Вася" ? "admin" : "manager",
      created_at: new Date().toISOString(),
    })),
    leads: [],
    payments: [],
    plans: [],
    employee_terms: [],
  };
}
