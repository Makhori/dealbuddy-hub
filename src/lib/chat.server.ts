import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  enqueueTelegramNotification,
  flushTelegramNotifications,
  isValidWebhookSecret,
  sendTelegramDocumentTo,
  sendTelegramTextTo,
} from "./telegram.server";

type SessionActor = { role: "admin" | "manager"; employeeId: string | null };

export type ChatMessageRow = {
  id: string;
  lead_id: string;
  manager_id: string | null;
  direction: "out" | "in";
  sender_type: "manager" | "client" | "system";
  body: string | null;
  attachment_file_id: string | null;
  attachment_file_name: string | null;
  attachment_mime: string | null;
  telegram_message_id: number | null;
  status: "pending" | "sent" | "delivered" | "failed";
  last_error: string | null;
  created_at: string;
};

function insertMessage(db: DatabaseSync, row: Omit<ChatMessageRow, "created_at">) {
  db.prepare(
    `
    INSERT INTO messages
      (id, lead_id, manager_id, direction, sender_type, body,
       attachment_file_id, attachment_file_name, attachment_mime,
       telegram_message_id, status, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    row.id,
    row.lead_id,
    row.manager_id,
    row.direction,
    row.sender_type,
    row.body,
    row.attachment_file_id,
    row.attachment_file_name,
    row.attachment_mime,
    row.telegram_message_id,
    row.status,
    row.last_error,
  );
}

/** Менеджер отправляет клиенту текст и/или один файл; сообщение сохраняется независимо от исхода отправки. */
export async function sendLeadMessage(
  db: DatabaseSync,
  actor: SessionActor,
  input: { leadId: string; body: string | null; file: File | null },
): Promise<ChatMessageRow> {
  const lead = db
    .prepare("SELECT id, manager_id, telegram_chat_id FROM leads WHERE id = ?")
    .get(input.leadId) as
    { id: string; manager_id: string | null; telegram_chat_id: number | null } | undefined;
  if (!lead) throw new Error("Заявка не найдена");
  if (actor.role !== "admin" && lead.manager_id !== actor.employeeId) {
    throw new Error("Недостаточно прав для этой заявки");
  }
  if (!lead.telegram_chat_id) {
    throw new Error("Клиент ещё не подключил Telegram-бота");
  }
  if (!input.body?.trim() && !input.file) {
    throw new Error("Пустое сообщение");
  }

  const id = randomUUID();
  const base: Omit<ChatMessageRow, "created_at"> = {
    id,
    lead_id: lead.id,
    manager_id: lead.manager_id,
    direction: "out",
    sender_type: "manager",
    body: input.body?.trim() || null,
    attachment_file_id: null,
    attachment_file_name: input.file?.name ?? null,
    attachment_mime: input.file?.type ?? null,
    telegram_message_id: null,
    status: "pending",
    last_error: null,
  };
  insertMessage(db, base);

  try {
    const result = input.file
      ? await sendTelegramDocumentTo(lead.telegram_chat_id, input.file, base.body)
      : await sendTelegramTextTo(lead.telegram_chat_id, base.body!);
    db.prepare(
      "UPDATE messages SET status = 'sent', telegram_message_id = ?, attachment_file_id = ? WHERE id = ?",
    ).run(result.messageId, result.fileId ?? null, id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE messages SET status = 'failed', last_error = ? WHERE id = ?").run(
      message,
      id,
    );
    throw new Error(message);
  }

  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as ChatMessageRow;
}

type TelegramFrom = { id: number; first_name?: string; last_name?: string; username?: string };

type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    from?: TelegramFrom;
    text?: string;
    caption?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    photo?: { file_id: string; file_size?: number }[];
    voice?: { file_id: string; mime_type?: string };
    video?: { file_id: string; mime_type?: string };
    video_note?: { file_id: string };
    audio?: { file_id: string; mime_type?: string; file_name?: string };
    animation?: { file_id: string; file_name?: string; mime_type?: string };
    sticker?: { file_id: string; emoji?: string };
    contact?: { first_name: string; last_name?: string; phone_number: string };
    location?: { latitude: number; longitude: number };
  };
};

/** Достаёт текст и/или вложение из сообщения любого поддерживаемого Telegram-типа. */
function extractContent(message: NonNullable<TelegramUpdate["message"]>) {
  if (message.document) {
    return {
      body: message.caption ?? null,
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? "document",
      mime: message.document.mime_type ?? null,
    };
  }
  const photo = message.photo?.at(-1);
  if (photo) {
    return {
      body: message.caption ?? null,
      fileId: photo.file_id,
      fileName: "photo.jpg",
      mime: "image/jpeg",
    };
  }
  if (message.voice) {
    return {
      body: message.caption ?? null,
      fileId: message.voice.file_id,
      fileName: "voice.ogg",
      mime: message.voice.mime_type ?? "audio/ogg",
    };
  }
  if (message.video) {
    return {
      body: message.caption ?? null,
      fileId: message.video.file_id,
      fileName: "video.mp4",
      mime: message.video.mime_type ?? "video/mp4",
    };
  }
  if (message.video_note) {
    return {
      body: null,
      fileId: message.video_note.file_id,
      fileName: "video_note.mp4",
      mime: "video/mp4",
    };
  }
  if (message.audio) {
    return {
      body: message.caption ?? null,
      fileId: message.audio.file_id,
      fileName: message.audio.file_name ?? "audio",
      mime: message.audio.mime_type ?? "audio/mpeg",
    };
  }
  if (message.animation) {
    return {
      body: message.caption ?? null,
      fileId: message.animation.file_id,
      fileName: message.animation.file_name ?? "animation.mp4",
      mime: message.animation.mime_type ?? "video/mp4",
    };
  }
  if (message.sticker) {
    return {
      body: message.sticker.emoji ? `Стикер ${message.sticker.emoji}` : "Стикер",
      fileId: null,
      fileName: null,
      mime: null,
    };
  }
  if (message.contact) {
    const name = [message.contact.first_name, message.contact.last_name].filter(Boolean).join(" ");
    return {
      body: `Контакт: ${name}, тел. ${message.contact.phone_number}`,
      fileId: null,
      fileName: null,
      mime: null,
    };
  }
  if (message.location) {
    return {
      body: `Геолокация: ${message.location.latitude}, ${message.location.longitude}`,
      fileId: null,
      fileName: null,
      mime: null,
    };
  }
  return {
    body: message.text ?? message.caption ?? null,
    fileId: null,
    fileName: null,
    mime: null,
  };
}

function clientDisplayName(from: TelegramFrom | undefined) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (from?.username) return `@${from.username}`;
  return "Клиент из Telegram";
}

/** Новый человек написал в бота впервые — заводим заявку, чтобы обращение не потерялось. */
function createLeadFromTelegramContact(
  db: DatabaseSync,
  chatId: number,
  from: TelegramFrom | undefined,
  initialText: string | null,
) {
  const id = randomUUID();
  const clientName = clientDisplayName(from);
  const username = from?.username ? `@${from.username}` : null;
  const leadDate = new Date().toISOString().slice(0, 10);
  db.prepare(
    `
    INSERT INTO leads (id, lead_date, client_name, telegram, telegram_chat_id, request, status, manager_id, origin)
    VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, 'manual')
  `,
  ).run(id, leadDate, clientName, username, chatId, initialText);
  return { id, managerId: null as string | null, clientName, telegram: username };
}

/** Принимает вебхук Telegram: связывает клиента с заявкой по /start и сохраняет входящие сообщения. */
export async function processTelegramWebhook(
  db: DatabaseSync,
  request: Request,
): Promise<Response> {
  if (!isValidWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const message = update.message;
  if (!message) return new Response("ok");
  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (text === "/start") {
    // Клиент просто нашёл бота и нажал Start, без ссылки от менеджера и без своего сообщения —
    // заявку пока не создаём, чтобы не плодить пустые карточки от случайных заходов.
    await sendTelegramTextTo(
      chatId,
      "Здравствуйте! Напишите, пожалуйста, что вас интересует — менеджер увидит сообщение и свяжется с вами.",
    ).catch(() => undefined);
    return new Response("ok");
  }

  if (text?.startsWith("/start ")) {
    const leadId = text.slice("/start ".length).trim();
    const targetLead = leadId
      ? (db.prepare("SELECT id FROM leads WHERE id = ?").get(leadId) as { id: string } | undefined)
      : undefined;
    if (targetLead) {
      const username = message.from?.username ? `@${message.from.username}` : null;
      db.prepare(
        "UPDATE leads SET telegram_chat_id = ?, telegram = COALESCE(?, telegram) WHERE id = ?",
      ).run(chatId, username, targetLead.id);
      await sendTelegramTextTo(
        chatId,
        "Вы подключены к чату с менеджером. Сообщения, которые вы отправите сюда, увидит ваш менеджер.",
      ).catch(() => undefined);
    } else {
      await sendTelegramTextTo(
        chatId,
        "Не удалось найти вашу заявку. Свяжитесь с менеджером, чтобы получить актуальную ссылку.",
      ).catch(() => undefined);
    }
    return new Response("ok");
  }

  const content = extractContent(message);
  const body = content.body;
  const attachmentFileId = content.fileId;
  const attachmentFileName = content.fileName;
  const attachmentMime = content.mime;

  const lead = db
    .prepare("SELECT id, manager_id FROM leads WHERE telegram_chat_id = ?")
    .get(chatId) as { id: string; manager_id: string | null } | undefined;

  if (lead) {
    insertMessage(db, {
      id: randomUUID(),
      lead_id: lead.id,
      manager_id: lead.manager_id,
      direction: "in",
      sender_type: "client",
      body,
      attachment_file_id: attachmentFileId,
      attachment_file_name: attachmentFileName,
      attachment_mime: attachmentMime,
      telegram_message_id: message.message_id,
      status: "delivered",
      last_error: null,
    });
    return new Response("ok");
  }

  // Незнакомый чат прислал что-то — заводим заявку, чтобы первое обращение не потерялось,
  // даже если это тип сообщения, который мы не умеем красиво разбирать (опрос, реакция и т.п.).
  const fallbackText =
    body ?? (attachmentFileId ? null : "Клиент написал в бота (сообщение неподдерживаемого типа)");
  const created = createLeadFromTelegramContact(db, chatId, message.from, fallbackText);
  insertMessage(db, {
    id: randomUUID(),
    lead_id: created.id,
    manager_id: created.managerId,
    direction: "in",
    sender_type: "client",
    body: fallbackText,
    attachment_file_id: attachmentFileId,
    attachment_file_name: attachmentFileName,
    attachment_mime: attachmentMime,
    telegram_message_id: message.message_id,
    status: "delivered",
    last_error: null,
  });
  enqueueTelegramNotification(db, created.id, {
    clientName: created.clientName,
    tariff: null,
    phone: null,
    telegram: created.telegram,
    request: fallbackText,
    source: "telegram_bot",
  });
  await flushTelegramNotifications(db);
  await sendTelegramTextTo(
    chatId,
    "Спасибо! Ваше сообщение получено, менеджер скоро свяжется с вами.",
  ).catch(() => undefined);

  return new Response("ok");
}
