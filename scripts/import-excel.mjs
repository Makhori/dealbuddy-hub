import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import XLSX from "xlsx";

/**
 * Загружает лиды и оплаты из исходного Excel-файла проекта в SQLite,
 * предварительно полностью очищая таблицы leads и payments.
 *
 * Источник: три "сырых" листа книги ("Лиды Паша", "Лиды Алина", "Оплаты").
 * Лист "дашборд" не импортируется — это вычисляемая сводка, а не данные.
 *
 * Использование: node scripts/import-excel.mjs [путь-к.xlsx]
 * По умолчанию путь — "../Запуск январь-февраль.xlsx" (рядом с папкой проекта).
 */

const root = resolve(import.meta.dirname, "..");
const env = readEnv(resolve(root, ".env"));
const dbPath = resolve(root, process.env.SQLITE_DB_PATH || env.SQLITE_DB_PATH || "data/pulse-crm.sqlite");
const xlsxPath = resolve(root, process.argv[2] || "../Запуск январь-февраль.xlsx");

if (!existsSync(xlsxPath)) {
  console.error(`Файл не найден: ${xlsxPath}`);
  process.exit(1);
}

const warnings = [];
const ASSUMED_YEAR = 2026;
const ALINA_STATUS_MAP = {
  "успешно": "won",
  "тотал игнор": "lost",
  "отказ клиента": "lost",
  "созвон проведен": "in_work",
  "созвон назначен": "in_work",
  "1 касание": "in_work",
  "в диалоге": "in_work",
};

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

const employees = db.prepare("SELECT id, full_name FROM employees").all();
const employeeIdByName = new Map(employees.map((e) => [normalizeName(e.full_name), e.id]));

const wb = XLSX.readFile(xlsxPath);
const sheet = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: null });

const leadsPasha = parsePashaLeads(sheet("Лиды Паша"), employeeIdByName.get(normalizeName("Паша")));
const leadsAlina = parseAlinaLeads(sheet("Лиды Алина"), employeeIdByName.get(normalizeName("Алина")));
const payments = parsePayments(sheet("Оплаты"), employeeIdByName);

const allLeads = [...leadsPasha, ...leadsAlina];

db.exec("BEGIN IMMEDIATE");
try {
  db.exec("DELETE FROM payments");
  db.exec("DELETE FROM leads");

  const insertLead = db.prepare(`
    INSERT INTO leads
      (id, lead_date, client_name, phone, telegram, income, request, status, source_status,
       tariff, amount, net_amount, payment_method, payment_date, comment, next_action, manager_id, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const lead of allLeads) {
    insertLead.run(
      lead.id, lead.lead_date, lead.client_name, lead.phone, lead.telegram, lead.income, lead.request,
      lead.status, lead.source_status, lead.tariff, lead.amount, lead.net_amount, lead.payment_method,
      lead.payment_date, lead.comment, lead.next_action, lead.manager_id, lead.position,
    );
  }

  // Best-effort связывание оплаты с выигранной заявкой того же менеджера по совпадению имени клиента.
  const wonByManagerAndName = new Map();
  for (const lead of allLeads) {
    if (lead.status !== "won") continue;
    const key = `${lead.manager_id ?? ""}::${normalizeName(lead.client_name)}`;
    if (!wonByManagerAndName.has(key)) wonByManagerAndName.set(key, []);
    wonByManagerAndName.get(key).push(lead.id);
  }

  const insertPayment = db.prepare(`
    INSERT INTO payments
      (id, order_no, client_name, contact, tariff, revenue, net_profit, receivable,
       payment_method, payment_date, manager_id, lead_id, schedule_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let linked = 0;
  for (const payment of payments) {
    const key = `${payment.manager_id ?? ""}::${normalizeName(payment.client_name)}`;
    const candidates = wonByManagerAndName.get(key);
    let leadId = null;
    if (candidates && candidates.length === 1) {
      leadId = candidates.pop();
      linked += 1;
    }
    insertPayment.run(
      payment.id, payment.order_no, payment.client_name, payment.contact, payment.tariff,
      payment.revenue, payment.net_profit, payment.receivable, payment.payment_method,
      payment.payment_date, payment.manager_id, leadId, payment.schedule_note,
    );
  }

  db.exec("COMMIT");
  report({ leadsPasha, leadsAlina, payments, linked });
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

function report({ leadsPasha, leadsAlina, payments, linked }) {
  const statusCounts = (rows) =>
    rows.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  console.log(`База: ${dbPath}`);
  console.log(`Лиды Паша: ${leadsPasha.length} строк —`, statusCounts(leadsPasha));
  console.log(`Лиды Алина: ${leadsAlina.length} строк —`, statusCounts(leadsAlina));
  console.log(`Оплаты: ${payments.length} строк, привязано к выигранным заявкам: ${linked}`);
  if (warnings.length) {
    console.log(`\nПредупреждения (${warnings.length}):`);
    for (const w of warnings) console.log(" -", w);
  }
  console.log("Готово.");
}

// ---------- парсинг листов ----------

function parsePashaLeads(rows, managerId) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const clientName = text(r[3]);
    if (!clientName) continue;
    const rawStatus = text(r[6]);
    out.push({
      id: randomUUID(),
      lead_date: parseDate(r[0]),
      client_name: clientName,
      phone: text(r[1]),
      telegram: text(r[2]),
      income: text(r[4]),
      request: text(r[5]),
      status: classifyPashaStatus(rawStatus),
      source_status: rawStatus,
      tariff: text(r[7]),
      amount: parseMoney(r[8]),
      net_amount: parseMoney(r[9]),
      payment_method: text(r[10]),
      payment_date: null,
      comment: null,
      next_action: text(r[11]),
      manager_id: managerId ?? null,
      position: out.length,
    });
  }
  return out;
}

function parseAlinaLeads(rows, managerId) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const clientName = text(r[1]);
    if (!clientName) continue;
    const rawStatus = text(r[6]);
    out.push({
      id: randomUUID(),
      lead_date: parseDate(r[0]),
      client_name: clientName,
      phone: text(r[2]),
      telegram: text(r[3]),
      income: text(r[4]),
      request: text(r[5]),
      status: classifyAlinaStatus(rawStatus),
      source_status: rawStatus,
      tariff: text(r[7]),
      amount: parseMoney(r[8]),
      net_amount: parseMoney(r[9]),
      payment_method: text(r[10]),
      payment_date: parseDate(r[11]),
      comment: text(r[12]),
      next_action: text(r[14]),
      manager_id: managerId ?? null,
      position: out.length,
    });
  }
  return out;
}

function parsePayments(rows, employeeIdByName) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const clientName = text(r[1]);
    if (!clientName) continue; // пропускает пустые строки и итоговую "Итог:"
    const orderNoRaw = text(r[0]);
    const orderNo = orderNoRaw && /^\d+$/.test(orderNoRaw) ? Number(orderNoRaw) : null;
    const managerName = text(r[9]);
    const paymentDate = parseDate(r[8]);
    if (!paymentDate) {
      warnings.push(`Оплаты, строка ${i + 1} (${clientName}): не удалось разобрать дату "${r[8]}", подставлено сегодня`);
    }
    out.push({
      id: randomUUID(),
      order_no: orderNo,
      client_name: clientName,
      contact: text(r[2]),
      tariff: text(r[3]),
      revenue: parseMoney(r[4]) ?? 0,
      net_profit: parseMoney(r[5]) ?? 0,
      receivable: parseMoney(r[6]),
      payment_method: text(r[7]),
      payment_date: paymentDate ?? new Date().toISOString().slice(0, 10),
      manager_id: resolveManagerId(managerName, employeeIdByName),
      schedule_note: text(r[10]),
    });
  }
  return out;
}

function resolveManagerId(rawName, employeeIdByName) {
  const name = normalizeName(rawName);
  if (!name) return null;
  // "ОП", "ОП и Вася" и т.п. — не конкретный сотрудник, оставляем без привязки.
  return employeeIdByName.get(name) ?? null;
}

// ---------- нормализация значений ----------

function text(value) {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  return t === "" ? null : t;
}

function normalizeName(value) {
  return (value ?? "").toString().trim().toLowerCase();
}

function parseMoney(value) {
  if (value === null || value === undefined) return null;
  // Валютный префикс вида "р." оставляет "лишнюю" точку в начале строки
  // (например "р.44,990.00" -> ".44,990.00"), поэтому точки-разделители
  // тысяч/префикса схлопываются, а последняя точка остаётся десятичной.
  let cleaned = String(value).replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return null;
  const parts = cleaned.split(".");
  if (parts.length > 2) cleaned = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  const t = text(value);
  if (!t) return null;
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (m) return `${ASSUMED_YEAR}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function classifyPashaStatus(raw) {
  const t = (raw ?? "").trim();
  if (!t) return "new";
  const low = t.toLowerCase();
  if (low.startsWith("оплат") || low.startsWith("купил") || low.startsWith("оплт") || low.startsWith("продан")) {
    return "won";
  }
  if (low.startsWith("отказ") && t.length < 15) return "lost";
  return "in_work";
}

function classifyAlinaStatus(raw) {
  const t = (raw ?? "").trim();
  if (!t) return "new";
  return ALINA_STATUS_MAP[t.toLowerCase()] ?? "in_work";
}

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
