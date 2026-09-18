import { createHash, randomUUID } from "node:crypto";
import { enqueueTelegramNotification, flushTelegramNotifications } from "./telegram.server";

/**
 * Забирает новые заявки из Google-таблицы (форма с колонками
 * "Отметка времени | Выберите продукт | Как к вам обращаться |
 *  Ваш номер телефона для связи | Ваш никнейм в Telegram | Запрос")
 * и создаёт из них лиды со статусом "new" и origin="google_sheets".
 *
 * Таблица опубликована в Google Sheets как CSV, поэтому OAuth,
 * сервисный аккаунт и Google SDK для импорта не нужны.
 */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/15jMSqIyBVVVvI8BE3QXsAa3FVLSOZ_fnjgN0Xcus23M/gviz/tq?tqx=out:csv&gid=1863668531";

const SHEET_COLUMNS = {
  timestamp: "Отметка времени",
  tariff: "Выберите продукт",
  clientName: "Как к вам обращаться",
  phone: "Ваш номер телефона для связи",
  telegram: "Ваш никнейм в Telegram",
  request: "Запрос",
} as const;

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;
    if (quoted) {
      if (char === '"' && csv[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (quoted) throw new Error("Некорректный CSV: незакрытая кавычка");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function fetchRows(): Promise<string[][]> {
  const url = new URL(SHEET_CSV_URL);
  url.searchParams.set("_", Date.now().toString());
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) {
    throw new Error(`Google Sheets вернул ошибку (${response.status})`);
  }
  return parseCsv(await response.text());
}

function rowHash(row: string[]) {
  return createHash("sha256").update(row.join("␟")).digest("hex");
}

/** "21.04.2026 15:16:23" -> "2026-04-21" (используется как lead_date). */
function parseSheetTimestamp(raw: string | undefined) {
  const m = (raw ?? "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

function clean(value: string | undefined) {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

function normalizeTariff(value: string | undefined) {
  const tariff = clean(value);
  if (tariff === "Обучение с VIP сопровождением от автора курса") {
    return "Обучение с VIP-сопровождением от автора курса";
  }
  return tariff;
}

function columnIndexes(header: string[]) {
  const normalized = header.map((value) => value.trim().replace(/^\uFEFF/, ""));
  const entries = Object.entries(SHEET_COLUMNS).map(([key, title]) => [
    key,
    normalized.indexOf(title),
  ]);
  const missing = entries
    .filter(([, index]) => index === -1)
    .map(([key]) => SHEET_COLUMNS[key as keyof typeof SHEET_COLUMNS]);
  if (missing.length > 0) {
    throw new Error(`В Google-таблице нет обязательных колонок: ${missing.join(", ")}`);
  }
  return Object.fromEntries(entries) as Record<keyof typeof SHEET_COLUMNS, number>;
}

export type SheetSyncResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  total: number;
  notified: number;
  notificationError?: string;
  error?: string;
};

let pollingStarted = false;

/** Запускает фоновый опрос таблицы раз в N минут, пока жив процесс сервера. */
export function startGoogleSheetsPolling(getDb: () => import("node:sqlite").DatabaseSync) {
  if (pollingStarted) return;
  pollingStarted = true;
  const minutes = Number(process.env["GOOGLE_SHEETS_SYNC_INTERVAL_MINUTES"] ?? "1");
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const run = () => {
    syncGoogleSheetLeads(getDb())
      .then((r) => {
        if (r.imported > 0)
          console.log(`[google-sheets] импортировано новых заявок: ${r.imported}`);
        if (!r.ok) console.error(`[google-sheets] ошибка синхронизации: ${r.error}`);
        if (r.notificationError)
          console.error(`[telegram] ошибка отправки: ${r.notificationError}`);
      })
      .catch((err) => console.error("[google-sheets] сбой синхронизации:", err));
  };
  void run();
  setInterval(run, minutes * 60_000).unref();
}

export async function syncGoogleSheetLeads(
  db: import("node:sqlite").DatabaseSync,
): Promise<SheetSyncResult> {
  try {
    const rows = await fetchRows();
    if (rows.length === 0) {
      const notifications = await flushTelegramNotifications(db);
      return {
        ok: true,
        imported: 0,
        skipped: 0,
        total: 0,
        notified: notifications.sent,
        notificationError: notifications.error,
      };
    }
    const indexes = columnIndexes(rows[0] ?? []);
    const dataRows = rows.slice(1); // первая строка — заголовки
    let imported = 0;
    let skipped = 0;

    const insertLead = db.prepare(`
      INSERT INTO leads
        (id, lead_date, client_name, phone, telegram, request, tariff, status, manager_id, origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, 'google_sheets')
    `);
    const insertImportLog = db.prepare(
      "INSERT INTO sheet_lead_imports (row_hash, lead_id) VALUES (?, ?)",
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      const alreadyImported = db.prepare("SELECT row_hash FROM sheet_lead_imports").all() as {
        row_hash: string;
      }[];
      const seen = new Set(alreadyImported.map((r) => r.row_hash));

      for (const row of dataRows) {
        if (row.every((cell) => !cell || !cell.trim())) continue; // пустая строка
        const hash = rowHash(row);
        if (seen.has(hash)) {
          skipped += 1;
          continue;
        }
        const clientName = clean(row[indexes.clientName]);
        if (!clientName) {
          skipped += 1;
          continue;
        }
        const leadId = randomUUID();
        const leadDate = parseSheetTimestamp(row[indexes.timestamp]);
        const phone = clean(row[indexes.phone]);
        const telegram = clean(row[indexes.telegram]);
        const request = clean(row[indexes.request]);
        const tariff = normalizeTariff(row[indexes.tariff]);
        insertLead.run(leadId, leadDate, clientName, phone, telegram, request, tariff);
        insertImportLog.run(hash, leadId);
        enqueueTelegramNotification(db, leadId, {
          clientName,
          tariff,
          phone,
          telegram,
          request,
        });
        seen.add(hash);
        imported += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const notifications = await flushTelegramNotifications(db);
    return {
      ok: true,
      imported,
      skipped,
      total: dataRows.length,
      notified: notifications.sent,
      notificationError: notifications.error,
    };
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      total: 0,
      notified: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
