import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { processTelegramWebhook, sendLeadMessage } from "./chat.server";
import { startGoogleSheetsPolling, syncGoogleSheetLeads } from "./google-sheets.server";
import {
  renderInvoiceRowPdf,
  saveInvoiceDraft,
  sendInvoiceToTelegram,
  type SaveInvoiceInput,
} from "./invoice.server";

export type AppUser = {
  id: string;
  email: string;
};

type SessionUser = {
  user: AppUser;
  role: "admin" | "manager";
  employeeId: string | null;
};

export type QueryInput = {
  token: string | null;
  table: TableName;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  columns?: string;
  payload?: Record<string, unknown> | Record<string, unknown>[];
  filters?: { op: "eq" | "neq" | "gte" | "lt"; column: string; value: unknown }[];
  order?: { column: string; ascending: boolean; nullsFirst?: boolean };
  limit?: number;
  single?: "single" | "maybe";
  onConflict?: string;
};

const TABLES = {
  user_roles: {
    columns: ["id", "user_id", "role", "created_at"],
    writable: ["user_id", "role"],
  },
  employees: {
    columns: [
      "id",
      "user_id",
      "full_name",
      "email",
      "position_title",
      "salary",
      "base_rate",
      "min_coef",
      "target_coef",
      "is_active",
      "created_at",
      "updated_at",
    ],
    writable: [
      "user_id",
      "full_name",
      "email",
      "position_title",
      "salary",
      "base_rate",
      "min_coef",
      "target_coef",
      "is_active",
    ],
  },
  leads: {
    columns: [
      "id",
      "lead_date",
      "client_name",
      "phone",
      "telegram",
      "income",
      "request",
      "status",
      "source_status",
      "tariff",
      "amount",
      "net_amount",
      "payment_method",
      "payment_date",
      "comment",
      "next_action",
      "manager_id",
      "position",
      "origin",
      "telegram_chat_id",
      "created_at",
      "updated_at",
    ],
    writable: [
      "lead_date",
      "client_name",
      "phone",
      "telegram",
      "income",
      "request",
      "status",
      "source_status",
      "tariff",
      "amount",
      "net_amount",
      "payment_method",
      "payment_date",
      "comment",
      "next_action",
      "manager_id",
      "position",
      "updated_at",
    ],
  },
  messages: {
    columns: [
      "id",
      "lead_id",
      "manager_id",
      "direction",
      "sender_type",
      "body",
      "attachment_file_id",
      "attachment_file_name",
      "attachment_mime",
      "telegram_message_id",
      "status",
      "last_error",
      "created_at",
    ],
    writable: [],
  },
  invoices: {
    columns: [
      "id",
      "lead_id",
      "manager_id",
      "number",
      "issue_date",
      "due_date",
      "client_name",
      "description",
      "amount",
      "status",
      "telegram_message_id",
      "last_error",
      "created_at",
      "updated_at",
    ],
    writable: [],
  },
  payments: {
    columns: [
      "id",
      "order_no",
      "client_name",
      "contact",
      "tariff",
      "revenue",
      "net_profit",
      "receivable",
      "payment_method",
      "payment_date",
      "manager_id",
      "lead_id",
      "schedule_note",
      "created_at",
    ],
    writable: [
      "order_no",
      "client_name",
      "contact",
      "tariff",
      "revenue",
      "net_profit",
      "receivable",
      "payment_method",
      "payment_date",
      "manager_id",
      "lead_id",
      "schedule_note",
    ],
  },
  plans: {
    columns: ["id", "period", "employee_id", "plan_min", "plan_target", "plan_max", "created_at"],
    writable: ["period", "employee_id", "plan_min", "plan_target", "plan_max"],
  },
  employee_terms: {
    columns: [
      "id",
      "employee_id",
      "period",
      "salary",
      "base_rate",
      "min_coef",
      "target_coef",
      "created_at",
    ],
    writable: ["employee_id", "period", "salary", "base_rate", "min_coef", "target_coef"],
  },
} as const;

type TableName = keyof typeof TABLES;

let database: DatabaseSync | undefined;

function getDatabase() {
  if (database) return database;
  const root = process.cwd();
  const path = resolve(root, process.env.SQLITE_DB_PATH || "data/pulse-crm.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  database.exec(readFileSync(resolve(root, "database/schema.sql"), "utf8"));
  migrateLeadsOrigin(database);
  migrateLeadsTelegramChatId(database);
  startGoogleSheetsPolling(() => database!);
  return database;
}

export async function syncGoogleSheets(token: string | null) {
  const actor = session(token);
  if (!actor || actor.role !== "admin")
    throw new Error("Только руководитель может запускать синхронизацию");
  return syncGoogleSheetLeads(getDatabase());
}

/** Принимает вебхук Telegram напрямую как HTTP-запрос (Telegram не проходит через сессии/RPC). */
export function handleTelegramWebhookRequest(request: Request) {
  return processTelegramWebhook(getDatabase(), request);
}

/** Отправка сообщения менеджером клиенту: текст и/или один файл, из multipart/form-data. */
export async function handleSendLeadMessageRequest(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const token = form.get("token");
  const leadId = form.get("lead_id");
  const body = form.get("body");
  const file = form.get("file");

  const actor = session(typeof token === "string" ? token : null);
  if (!actor) return Response.json({ error: "Сессия истекла. Войдите снова." }, { status: 401 });
  if (typeof leadId !== "string" || !leadId) {
    return Response.json({ error: "Не указана заявка" }, { status: 400 });
  }

  try {
    const message = await sendLeadMessage(getDatabase(), actor, {
      leadId,
      body: typeof body === "string" ? body : null,
      file: file instanceof File ? file : null,
    });
    return Response.json({ message });
  } catch (error) {
    const description = error instanceof Error ? error.message : "Не удалось отправить сообщение";
    return Response.json({ error: description }, { status: 400 });
  }
}

/** Создаёт или обновляет черновик счёта. */
export function saveInvoice(token: string | null, input: SaveInvoiceInput) {
  const actor = session(token);
  if (!actor) throw new Error("Сессия истекла. Войдите снова.");
  return saveInvoiceDraft(getDatabase(), actor, input);
}

/** Отправляет счёт клиенту в Telegram и логирует его в единой истории переписки. */
export function sendInvoice(token: string | null, invoiceId: string) {
  const actor = session(token);
  if (!actor) throw new Error("Сессия истекла. Войдите снова.");
  return sendInvoiceToTelegram(getDatabase(), actor, invoiceId);
}

/** Отдаёт PDF счёта — генерируется на лету из сохранённых полей, ничего бинарного в БД не хранится. */
export async function handleInvoicePdfRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const actor = session(url.searchParams.get("token"));
  if (!actor) return new Response("Сессия истекла", { status: 401 });
  const invoiceId = url.searchParams.get("invoice_id");
  if (!invoiceId) return new Response("Не указан счёт", { status: 400 });

  const row = getDatabase().prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as
    { manager_id: string | null; number: number } | undefined;
  if (!row) return new Response("Не найдено", { status: 404 });
  if (actor.role !== "admin" && row.manager_id !== actor.employeeId) {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const invoice = getDatabase()
    .prepare("SELECT * FROM invoices WHERE id = ?")
    .get(invoiceId) as Parameters<typeof renderInvoiceRowPdf>[0];
  const pdf = await renderInvoiceRowPdf(invoice);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${encodeURIComponent(`Счёт №${row.number}.pdf`)}"`,
    },
  });
}

/** Отдаёт вложение из переписки, скачивая его с серверов Telegram — токен бота наружу не идёт. */
export async function handleTelegramFileRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const actor = session(url.searchParams.get("token"));
  if (!actor) return new Response("Сессия истекла", { status: 401 });
  const messageId = url.searchParams.get("message_id");
  if (!messageId) return new Response("Не указано сообщение", { status: 400 });

  const row = getDatabase()
    .prepare(
      "SELECT manager_id, attachment_file_id, attachment_file_name, attachment_mime FROM messages WHERE id = ?",
    )
    .get(messageId) as
    | {
        manager_id: string | null;
        attachment_file_id: string | null;
        attachment_file_name: string | null;
        attachment_mime: string | null;
      }
    | undefined;
  if (!row || !row.attachment_file_id) return new Response("Не найдено", { status: 404 });
  if (actor.role !== "admin" && row.manager_id !== actor.employeeId) {
    return new Response("Недостаточно прав", { status: 403 });
  }

  try {
    const { fetchTelegramFile } = await import("./telegram.server");
    const upstream = await fetchTelegramFile(row.attachment_file_id);
    return new Response(upstream.body, {
      headers: {
        "content-type":
          row.attachment_mime || upstream.headers.get("content-type") || "application/octet-stream",
        "content-disposition": `attachment; filename="${encodeURIComponent(row.attachment_file_name || "file")}"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Ошибка загрузки файла", {
      status: 502,
    });
  }
}

/** Заявки, созданные до появления поля `origin`, получают его через ALTER TABLE. */
function migrateLeadsOrigin(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "origin")) {
    db.exec(
      "ALTER TABLE leads ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'google_sheets'))",
    );
  }
}

/**
 * Заявки, созданные до чата с клиентом в Telegram, получают колонку для chat_id через ALTER TABLE.
 * Индекс создаётся отдельно от schema.sql: на уже существующей таблице колонки может ещё не быть
 * в момент выполнения того файла, а CREATE TABLE IF NOT EXISTS её туда не добавит.
 */
function migrateLeadsTelegramChatId(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "telegram_chat_id")) {
    db.exec("ALTER TABLE leads ADD COLUMN telegram_chat_id INTEGER");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS leads_telegram_chat_uidx ON leads(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL",
  );
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 64);
}

export function login(email: string, password: string) {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT id, email, password_hash, password_salt FROM users WHERE email = ? AND is_active = 1",
    )
    .get(email) as
    { id: string; email: string; password_hash: string; password_salt: string } | undefined;
  if (!row) throw new Error("Неверная почта или пароль");
  const actual = passwordHash(password, row.password_salt);
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Неверная почта или пароль");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    tokenHash(token),
    row.id,
    expiresAt,
  );
  return { token, expiresAt, user: { id: row.id, email: row.email } satisfies AppUser };
}

export function session(token: string | null): SessionUser | null {
  if (!token) return null;
  const row = getDatabase()
    .prepare(
      `
      SELECT u.id, u.email,
             CASE WHEN EXISTS (
               SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'admin'
             ) THEN 'admin' ELSE 'manager' END AS role,
             e.id AS employee_id
      FROM sessions s
      JOIN users u ON u.id = s.user_id AND u.is_active = 1
      LEFT JOIN employees e ON e.user_id = u.id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `,
    )
    .get(tokenHash(token), new Date().toISOString()) as
    | { id: string; email: string; role: "admin" | "manager"; employee_id: string | null }
    | undefined;
  return row
    ? { user: { id: row.id, email: row.email }, role: row.role, employeeId: row.employee_id }
    : null;
}

export function logout(token: string | null) {
  if (token)
    getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
}

export function executeQuery(input: QueryInput) {
  const actor = session(input.token);
  if (!actor) throw new Error("Сессия истекла. Войдите снова.");
  if (!(input.table in TABLES)) throw new Error("Недоступная таблица");
  if (input.action === "select") return selectRows(input, actor);
  return mutateRows(input, actor);
}

function selectRows(input: QueryInput, actor: SessionUser) {
  const db = getDatabase();
  const config = TABLES[input.table];
  const selected =
    input.columns && input.columns !== "*"
      ? input.columns.split(",").map((x) => x.trim())
      : [...config.columns];
  for (const column of selected) assertColumn(input.table, column);
  const params: unknown[] = [];
  const clauses = [...accessClauses(input.table, actor, params), ...filterClauses(input, params)];
  let sql = `SELECT ${selected.map(quote).join(", ")} FROM ${quote(input.table)}`;
  if (clauses.length) sql += ` WHERE ${clauses.join(" AND ")}`;
  if (input.order) {
    assertColumn(input.table, input.order.column);
    sql += ` ORDER BY ${quote(input.order.column)} ${input.order.ascending ? "ASC" : "DESC"}`;
    if (input.order.nullsFirst !== undefined)
      sql += input.order.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
  }
  if (input.limit !== undefined) {
    sql += " LIMIT ?";
    params.push(input.limit);
  }
  const rows = db
    .prepare(sql)
    .all(...params)
    .map((row) => normalizeRow(input.table, row));
  if (input.single === "single") {
    if (rows.length !== 1)
      throw new Error(rows.length ? "Ожидалась одна запись" : "Запись не найдена");
    return rows[0];
  }
  if (input.single === "maybe") {
    if (rows.length > 1) throw new Error("Найдено больше одной записи");
    return rows[0] ?? null;
  }
  return rows;
}

function mutateRows(input: QueryInput, actor: SessionUser) {
  const db = getDatabase();
  if (input.action !== "insert" && input.action !== "upsert" && !input.filters?.length) {
    throw new Error("Изменение без фильтра запрещено");
  }
  if (input.action === "insert" || input.action === "upsert") {
    const source = Array.isArray(input.payload) ? input.payload : [input.payload ?? {}];
    const rows = source.map((payload) => prepareInsert(input.table, payload, actor));
    const results: unknown[] = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const keys = Object.keys(row);
        const placeholders = keys.map(() => "?").join(", ");
        let sql = `INSERT INTO ${quote(input.table)} (${keys.map(quote).join(", ")}) VALUES (${placeholders})`;
        if (input.action === "upsert") {
          const conflict = (input.onConflict ?? "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          if (!conflict.length) throw new Error("Для upsert нужен onConflict");
          conflict.forEach((column) => assertColumn(input.table, column));
          const updates = keys.filter((key) => key !== "id" && !conflict.includes(key));
          sql += ` ON CONFLICT (${conflict.map(quote).join(", ")}) DO UPDATE SET ${updates
            .map((key) => `${quote(key)} = excluded.${quote(key)}`)
            .join(", ")}`;
        }
        sql += " RETURNING *";
        results.push(
          normalizeRow(
            input.table,
            db.prepare(sql).get(...keys.map((key) => normalizeValue(row[key]))),
          ),
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return Array.isArray(input.payload) ? results : (results[0] ?? null);
  }

  const params: unknown[] = [];
  const clauses = [
    ...accessClauses(input.table, actor, params, true),
    ...filterClauses(input, params),
  ];
  if (input.action === "delete") {
    const sql = `DELETE FROM ${quote(input.table)} WHERE ${clauses.join(" AND ")} RETURNING *`;
    return db
      .prepare(sql)
      .all(...params)
      .map((row) => normalizeRow(input.table, row));
  }

  const payload = sanitizePayload(input.table, input.payload as Record<string, unknown>);
  const keys = Object.keys(payload);
  if (!keys.length) throw new Error("Нет полей для изменения");
  const setParams = keys.map((key) => normalizeValue(payload[key]));
  const sql = `UPDATE ${quote(input.table)} SET ${keys.map((key) => `${quote(key)} = ?`).join(", ")} WHERE ${clauses.join(" AND ")} RETURNING *`;
  return db
    .prepare(sql)
    .all(...setParams, ...params)
    .map((row) => normalizeRow(input.table, row));
}

function prepareInsert(table: TableName, payload: Record<string, unknown>, actor: SessionUser) {
  assertCanWrite(table, actor);
  const row = { id: randomUUID(), ...sanitizePayload(table, payload) } as Record<string, unknown>;
  if (actor.role !== "admin" && (table === "leads" || table === "payments"))
    row.manager_id = actor.employeeId;
  return row;
}

function sanitizePayload(table: TableName, payload: Record<string, unknown> | undefined) {
  const result: Record<string, unknown> = {};
  if (!payload) return result;
  const writable = new Set<string>(TABLES[table].writable);
  for (const [key, value] of Object.entries(payload)) {
    if (!writable.has(key)) throw new Error(`Поле ${key} нельзя изменять`);
    result[key] = value;
  }
  return result;
}

function assertCanWrite(table: TableName, actor: SessionUser) {
  if (actor.role === "admin") return;
  if (table !== "leads" && table !== "payments") throw new Error("Недостаточно прав");
  if (!actor.employeeId) throw new Error("Пользователь не связан с сотрудником");
}

function accessClauses(table: TableName, actor: SessionUser, params: unknown[], writing = false) {
  if (actor.role === "admin") return [];
  if (writing) assertCanWrite(table, actor);
  if (!actor.employeeId && table !== "user_roles")
    throw new Error("Пользователь не связан с сотрудником");
  if (table === "user_roles") {
    params.push(actor.user.id);
    return [`${quote("user_id")} = ?`];
  }
  if (table === "employees") {
    params.push(actor.user.id);
    return [`${quote("user_id")} = ?`];
  }
  if (table === "plans") {
    params.push(actor.employeeId);
    return [`(${quote("employee_id")} = ? OR ${quote("employee_id")} IS NULL)`];
  }
  params.push(actor.employeeId);
  return [`${quote(table === "employee_terms" ? "employee_id" : "manager_id")} = ?`];
}

function filterClauses(input: QueryInput, params: unknown[]) {
  return (input.filters ?? []).map((filter) => {
    assertColumn(input.table, filter.column);
    if (filter.value === null) {
      if (filter.op === "eq") return `${quote(filter.column)} IS NULL`;
      if (filter.op === "neq") return `${quote(filter.column)} IS NOT NULL`;
      throw new Error("NULL поддерживается только для eq/neq");
    }
    const operators = { eq: "=", neq: "!=", gte: ">=", lt: "<" } as const;
    params.push(normalizeValue(filter.value));
    return `${quote(filter.column)} ${operators[filter.op]} ?`;
  });
}

function assertColumn(table: TableName, column: string) {
  if (!(TABLES[table].columns as readonly string[]).includes(column))
    throw new Error(`Недоступное поле: ${column}`);
}

function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeValue(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as string | number | null;
}

function normalizeRow(table: TableName, source: unknown) {
  const row = { ...(source as Record<string, unknown>) };
  if (table === "employees" && "is_active" in row) row.is_active = Boolean(row.is_active);
  return row;
}

export function createEmployeeAccount(
  token: string | null,
  data: {
    full_name: string;
    email: string;
    password: string;
    position_title: string;
    salary: number;
    base_rate: number;
    min_coef: number;
    target_coef: number;
    is_admin: boolean;
  },
) {
  const actor = session(token);
  if (!actor || actor.role !== "admin")
    throw new Error("Только руководитель может добавлять сотрудников");
  const db = getDatabase();
  const userId = randomUUID();
  const employeeId = randomUUID();
  const period = new Date().toISOString().slice(0, 8) + "01";
  const salt = randomBytes(16).toString("hex");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)",
    ).run(userId, data.email, passwordHash(data.password, salt).toString("hex"), salt);
    db.prepare(
      `
      INSERT INTO employees
        (id, user_id, full_name, email, position_title, salary, base_rate, min_coef, target_coef)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      employeeId,
      userId,
      data.full_name,
      data.email,
      data.position_title,
      data.salary,
      data.base_rate,
      data.min_coef,
      data.target_coef,
    );
    db.prepare("INSERT INTO user_roles (id, user_id, role) VALUES (?, ?, ?)").run(
      randomUUID(),
      userId,
      data.is_admin ? "admin" : "manager",
    );
    db.prepare(
      `
      INSERT INTO employee_terms
        (id, employee_id, period, salary, base_rate, min_coef, target_coef)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      randomUUID(),
      employeeId,
      period,
      data.salary,
      data.base_rate,
      data.min_coef,
      data.target_coef,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { ok: true, userId, employeeId };
}
