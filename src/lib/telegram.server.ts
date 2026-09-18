import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type LeadNotification = {
  clientName: string;
  tariff: string | null;
  phone: string | null;
  telegram: string | null;
  request: string | null;
  source?: "google_sheets" | "telegram_bot";
};

function telegramConfig() {
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_CHAT_ID"]?.trim();
  return token && chatId ? { token, chatId } : null;
}

function botToken() {
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  if (!token) throw new Error("Telegram-бот не настроен");
  return token;
}

/** Публичное имя бота для диплинков "t.me/<username>?start=<lead_id>". */
export function telegramBotUsername() {
  return process.env["TELEGRAM_BOT_USERNAME"]?.trim() || null;
}

export type TelegramSendResult = { messageId: number; fileId?: string };

/** Отправляет текстовое сообщение клиенту в конкретный чат (не в служебный чат руководителя). */
export async function sendTelegramTextTo(
  chatId: number,
  text: string,
): Promise<TelegramSendResult> {
  const response = await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const result = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id: number };
  };
  if (!response.ok || !result.ok || !result.result) {
    throw new Error(result.description || `Telegram API вернул ${response.status}`);
  }
  return { messageId: result.result.message_id };
}

/** Отправляет вложение (File из формы браузера) клиенту, с опциональной подписью. */
export async function sendTelegramDocumentTo(
  chatId: number,
  file: File,
  caption?: string | null,
): Promise<TelegramSendResult> {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption);
  form.set("document", file, file.name);

  const response = await fetch(`https://api.telegram.org/bot${botToken()}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const result = (await response.json()) as {
    ok?: boolean;
    description?: string;
    result?: { message_id: number; document?: { file_id: string } };
  };
  if (!response.ok || !result.ok || !result.result) {
    throw new Error(result.description || `Telegram API вернул ${response.status}`);
  }
  const fileId = result.result.document?.file_id;
  return fileId
    ? { messageId: result.result.message_id, fileId }
    : { messageId: result.result.message_id };
}

/** Скачивает файл по file_id — используется только на сервере, чтобы не светить токен бота в браузере. */
export async function fetchTelegramFile(fileId: string): Promise<Response> {
  const token = botToken();
  const infoResponse = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const info = (await infoResponse.json()) as {
    ok?: boolean;
    description?: string;
    result?: { file_path: string };
  };
  if (!infoResponse.ok || !info.ok || !info.result) {
    throw new Error(info.description || "Не удалось получить файл из Telegram");
  }
  const fileResponse = await fetch(
    `https://api.telegram.org/file/bot${token}/${info.result.file_path}`,
  );
  if (!fileResponse.ok || !fileResponse.body) {
    throw new Error("Не удалось скачать файл из Telegram");
  }
  return fileResponse;
}

/** Проверяет заголовок вебхука против секрета, заданного при регистрации setWebhook. */
export function isValidWebhookSecret(headerValue: string | null) {
  const expected = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
  if (!expected) return true; // секрет не настроен — пропускаем проверку (только для локальной отладки)
  return headerValue === expected;
}

function valueOrDash(value: string | null) {
  return value?.trim() || "—";
}

function notificationText(lead: LeadNotification) {
  const title =
    lead.source === "telegram_bot"
      ? "🆕 Новое обращение в Telegram-боте"
      : "🆕 Новая заявка из Google Sheets";
  return [
    title,
    "",
    `Имя: ${lead.clientName}`,
    `Тариф: ${valueOrDash(lead.tariff)}`,
    `Телефон: ${valueOrDash(lead.phone)}`,
    `Telegram: ${valueOrDash(lead.telegram)}`,
    `Запрос: ${valueOrDash(lead.request)}`,
  ].join("\n");
}

export function enqueueTelegramNotification(
  db: DatabaseSync,
  leadId: string,
  lead: LeadNotification,
) {
  db.prepare(
    `
    INSERT OR IGNORE INTO telegram_notification_outbox (id, lead_id, message)
    VALUES (?, ?, ?)
  `,
  ).run(randomUUID(), leadId, notificationText(lead));
}

export async function sendTelegramMessage(text: string) {
  const config = telegramConfig();
  if (!config) throw new Error("Telegram-бот не настроен");

  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ chat_id: config.chatId, text }),
  });
  const result = (await response.json()) as { ok?: boolean; description?: string };
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API вернул ${response.status}`);
  }
}

export async function flushTelegramNotifications(db: DatabaseSync) {
  if (!telegramConfig()) return { sent: 0, failed: 0, error: undefined as string | undefined };

  const pending = db
    .prepare(
      `
      SELECT id, message
      FROM telegram_notification_outbox
      WHERE sent_at IS NULL
      ORDER BY created_at
      LIMIT 20
    `,
    )
    .all() as { id: string; message: string }[];
  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;

  for (const item of pending) {
    try {
      await sendTelegramMessage(item.message);
      db.prepare(
        `
        UPDATE telegram_notification_outbox
        SET sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), attempts = attempts + 1,
            last_error = NULL
        WHERE id = ?
      `,
      ).run(item.id);
      sent += 1;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      db.prepare(
        `
        UPDATE telegram_notification_outbox
        SET attempts = attempts + 1, last_error = ?
        WHERE id = ?
      `,
      ).run(lastError, item.id);
      failed += 1;
    }
  }

  return { sent, failed, error: lastError };
}
