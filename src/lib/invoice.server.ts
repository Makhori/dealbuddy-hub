import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import PDFDocument from "pdfkit";
import { sendTelegramDocumentTo } from "./telegram.server";

type SessionActor = { role: "admin" | "manager"; employeeId: string | null };

export type InvoiceRow = {
  id: string;
  lead_id: string;
  manager_id: string | null;
  number: number;
  issue_date: string;
  due_date: string | null;
  client_name: string;
  description: string;
  amount: number;
  status: "draft" | "sent" | "failed";
  telegram_message_id: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const COMPANY = {
  fullName: "Общество с ограниченной ответственностью «ДокаТекстиль»",
  shortName: "ООО «ДокаТекстиль»",
  inn: "7715842336",
  kpp: "771701001",
  ogrn: "5107746010543",
  address: "129226, г. Москва, ул. Сельскохозяйственная, д. 4, стр. 1",
  bankName: "ПАО Сбербанк г. Москва",
  bankAccount: "40702810938000027385",
  correspondentAccount: "30101810400000000225",
  bik: "044525225",
  phone: "8 (495) 221-05-78",
  email: "snab@trendsklad.ru",
  director: "Лаврентьева В.В.",
  accountant: "Лаврентьева В.В.",
};

const FONT_REGULAR = resolve(process.cwd(), "assets/fonts/PTSans-Regular.ttf");
const FONT_BOLD = resolve(process.cwd(), "assets/fonts/PTSans-Bold.ttf");

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function formatDateRu(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_RU[m - 1]} ${y} г.`;
}

function formatMoney(n: number) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_FEMININE = [
  "",
  "одна",
  "две",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
];
const TEENS = [
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
];
const TENS = [
  "",
  "",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
];
const HUNDREDS = [
  "",
  "сто",
  "двести",
  "триста",
  "четыреста",
  "пятьсот",
  "шестьсот",
  "семьсот",
  "восемьсот",
  "девятьсот",
];

function pluralize(n: number, forms: readonly [string, string, string]) {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function threeDigitsToWords(n: number, feminine: boolean): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]!);
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]!);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) words.push(TENS[tens]!);
    if (ones) words.push((feminine ? ONES_FEMININE : ONES)[ones]!);
  }
  return words.join(" ");
}

function integerToWords(n: number): string {
  if (n === 0) return "ноль";
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (billions) {
    parts.push(
      threeDigitsToWords(billions, false),
      pluralize(billions, ["миллиард", "миллиарда", "миллиардов"]),
    );
  }
  if (millions) {
    parts.push(
      threeDigitsToWords(millions, false),
      pluralize(millions, ["миллион", "миллиона", "миллионов"]),
    );
  }
  if (thousands) {
    parts.push(
      threeDigitsToWords(thousands, true),
      pluralize(thousands, ["тысяча", "тысячи", "тысяч"]),
    );
  }
  if (rest || parts.length === 0) parts.push(threeDigitsToWords(rest, false));
  return parts.filter(Boolean).join(" ");
}

function capitalize(s: string) {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** "1234.5" -> "Одна тысяча двести тридцать четыре рубля 50 копеек". */
function amountInWords(amount: number): string {
  const totalKopecks = Math.round(amount * 100);
  const rubles = Math.floor(totalKopecks / 100);
  const kopecks = totalKopecks % 100;
  const rublesWords = capitalize(integerToWords(rubles));
  const rublesLabel = pluralize(rubles, ["рубль", "рубля", "рублей"]);
  const kopecksLabel = pluralize(kopecks, ["копейка", "копейки", "копеек"]);
  return `${rublesWords} ${rublesLabel} ${String(kopecks).padStart(2, "0")} ${kopecksLabel}`;
}

export type InvoicePdfInput = {
  number: number;
  issueDate: string;
  dueDate: string | null;
  clientName: string;
  description: string;
  amount: number;
};

export function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolvePromise(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.registerFont("base", FONT_REGULAR);
    doc.registerFont("bold", FONT_BOLD);
    doc.font("base");

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.fontSize(8);
    doc.text(
      `Внимание! Оплата данного счёта означает согласие с условиями поставки товара. Уведомление об оплате обязательно, в противном случае поставщик не гарантирует наличие товара на складе.`,
      { width },
    );
    doc.moveDown(0.5);

    const bankTop = doc.y;
    doc.rect(left, bankTop, width, 62).stroke();
    doc
      .font("bold")
      .fontSize(9)
      .text("Получатель платежа", left + 8, bankTop + 6);
    doc.font("base").fontSize(9);
    doc.text(
      `${COMPANY.shortName}   ИНН ${COMPANY.inn}   КПП ${COMPANY.kpp}`,
      left + 8,
      bankTop + 20,
      {
        width: width - 16,
      },
    );
    doc.text(`Р/с ${COMPANY.bankAccount}`, left + 8, bankTop + 34);
    doc.text(
      `Банк: ${COMPANY.bankName}, БИК ${COMPANY.bik}, к/с ${COMPANY.correspondentAccount}`,
      left + 8,
      bankTop + 48,
      {
        width: width - 16,
      },
    );
    doc.x = left;
    doc.y = bankTop + 70;

    doc.moveDown(1);
    doc
      .font("bold")
      .fontSize(14)
      .text(`Счёт на оплату № ${input.number} от ${formatDateRu(input.issueDate)}`, {
        align: "center",
      });
    doc.moveDown(1);

    doc.font("base").fontSize(9);
    doc.text(
      `Поставщик: ${COMPANY.fullName}, ИНН ${COMPANY.inn}, КПП ${COMPANY.kpp}, ОГРН ${COMPANY.ogrn}, ${COMPANY.address}`,
      { width },
    );
    doc.moveDown(0.3);
    doc.text(`Покупатель: ${input.clientName}`, { width });
    doc.moveDown(1);

    const tableTop = doc.y;
    const cols = [
      { title: "№", width: 25 },
      { title: "Наименование товара (работ, услуг)", width: width - 25 - 40 - 30 - 80 - 90 },
      { title: "Кол-во", width: 40 },
      { title: "Ед.", width: 30 },
      { title: "Цена", width: 80 },
      { title: "Сумма", width: 90 },
    ];
    let x = left;
    const rowHeight = 22;
    doc.font("bold").fontSize(8);
    doc.rect(left, tableTop, width, rowHeight).stroke();
    for (const col of cols) {
      doc.text(col.title, x + 3, tableTop + 6, { width: col.width - 6 });
      if (x > left)
        doc
          .moveTo(x, tableTop)
          .lineTo(x, tableTop + rowHeight)
          .stroke();
      x += col.width;
    }

    const dataRowTop = tableTop + rowHeight;
    doc.font("base").fontSize(8);
    doc.rect(left, dataRowTop, width, rowHeight).stroke();
    x = left;
    const cells = [
      "1",
      input.description,
      "1",
      "усл.",
      formatMoney(input.amount),
      formatMoney(input.amount),
    ];
    cols.forEach((col, i) => {
      doc.text(cells[i]!, x + 3, dataRowTop + 6, { width: col.width - 6 });
      if (x > left)
        doc
          .moveTo(x, dataRowTop)
          .lineTo(x, dataRowTop + rowHeight)
          .stroke();
      x += col.width;
    });

    doc.x = left;
    doc.y = dataRowTop + rowHeight + 12;
    doc
      .font("bold")
      .fontSize(10)
      .text(`Итого: ${formatMoney(input.amount)} руб.`, left, doc.y, { width, align: "right" });
    doc.font("base").fontSize(9).text("Без налога (НДС)", left, doc.y, { width, align: "right" });
    doc.moveDown(0.8);
    doc.x = left;
    doc
      .font("base")
      .fontSize(9)
      .text(`Всего наименований 1 на сумму ${formatMoney(input.amount)} руб.`, { width });
    doc.font("bold").text(amountInWords(input.amount), { width });

    if (input.dueDate) {
      doc.moveDown(0.8);
      doc.x = left;
      doc.font("base").text(`Оплатить до: ${formatDateRu(input.dueDate)}`, { width });
    }

    doc.moveDown(2);
    doc.x = left;
    doc.font("base").fontSize(10);
    doc.text(`Руководитель организации  _______________  / ${COMPANY.director} /`, { width });
    doc.moveDown(0.6);
    doc.x = left;
    doc.text(`Главный бухгалтер          _______________  / ${COMPANY.accountant} /`, { width });

    doc.moveDown(1.5);
    doc.x = left;
    doc.fontSize(8).text(`Тел: ${COMPANY.phone}   Email: ${COMPANY.email}`, { width });

    doc.end();
  });
}

function insertInvoice(db: DatabaseSync, row: Omit<InvoiceRow, "created_at" | "updated_at">) {
  db.prepare(
    `
    INSERT INTO invoices
      (id, lead_id, manager_id, number, issue_date, due_date, client_name, description, amount,
       status, telegram_message_id, last_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    row.id,
    row.lead_id,
    row.manager_id,
    row.number,
    row.issue_date,
    row.due_date,
    row.client_name,
    row.description,
    row.amount,
    row.status,
    row.telegram_message_id,
    row.last_error,
  );
}

function assertLeadAccess(db: DatabaseSync, actor: SessionActor, leadId: string) {
  const lead = db
    .prepare("SELECT id, manager_id, client_name, telegram_chat_id FROM leads WHERE id = ?")
    .get(leadId) as
    | {
        id: string;
        manager_id: string | null;
        client_name: string;
        telegram_chat_id: number | null;
      }
    | undefined;
  if (!lead) throw new Error("Заявка не найдена");
  if (actor.role !== "admin" && lead.manager_id !== actor.employeeId) {
    throw new Error("Недостаточно прав для этой заявки");
  }
  return lead;
}

export type SaveInvoiceInput = {
  id: string | null;
  leadId: string;
  description: string;
  amount: number;
  issueDate: string;
  dueDate: string | null;
};

/** Создаёт черновик счёта или обновляет уже существующий (номер и статус не трогает при апдейте). */
export function saveInvoiceDraft(
  db: DatabaseSync,
  actor: SessionActor,
  input: SaveInvoiceInput,
): InvoiceRow {
  const lead = assertLeadAccess(db, actor, input.leadId);
  if (!input.description.trim()) throw new Error("Укажите описание услуги");
  if (!(input.amount > 0)) throw new Error("Сумма должна быть больше нуля");

  if (input.id) {
    const existing = db.prepare("SELECT * FROM invoices WHERE id = ?").get(input.id) as
      InvoiceRow | undefined;
    if (!existing || existing.lead_id !== input.leadId) throw new Error("Счёт не найден");
    db.prepare(
      `
      UPDATE invoices
      SET description = ?, amount = ?, issue_date = ?, due_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `,
    ).run(input.description.trim(), input.amount, input.issueDate, input.dueDate, input.id);
    return db.prepare("SELECT * FROM invoices WHERE id = ?").get(input.id) as InvoiceRow;
  }

  const id = randomUUID();
  const { number } = db
    .prepare("SELECT COALESCE(MAX(number), 0) + 1 AS number FROM invoices")
    .get() as {
    number: number;
  };
  insertInvoice(db, {
    id,
    lead_id: lead.id,
    manager_id: lead.manager_id,
    number,
    issue_date: input.issueDate,
    due_date: input.dueDate,
    client_name: lead.client_name,
    description: input.description.trim(),
    amount: input.amount,
    status: "draft",
    telegram_message_id: null,
    last_error: null,
  });
  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as InvoiceRow;
}

/** Рендерит PDF готового (уже сохранённого) счёта — используется и для отправки, и для скачивания. */
export function renderInvoiceRowPdf(row: InvoiceRow): Promise<Buffer> {
  return renderInvoicePdf({
    number: row.number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    clientName: row.client_name,
    description: row.description,
    amount: row.amount,
  });
}

/** Отправляет счёт клиенту в Telegram и сохраняет его же как сообщение в единой истории переписки. */
export async function sendInvoiceToTelegram(
  db: DatabaseSync,
  actor: SessionActor,
  invoiceId: string,
): Promise<InvoiceRow> {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as
    InvoiceRow | undefined;
  if (!invoice) throw new Error("Счёт не найден");
  const lead = assertLeadAccess(db, actor, invoice.lead_id);
  if (!lead.telegram_chat_id) throw new Error("Клиент ещё не подключил Telegram-бота");

  const pdf = await renderInvoiceRowPdf(invoice);
  const fileName = `Счёт №${invoice.number}.pdf`;
  const file = new File([new Uint8Array(pdf)], fileName, { type: "application/pdf" });
  const caption = `Счёт № ${invoice.number} от ${formatDateRu(invoice.issue_date)} на сумму ${formatMoney(invoice.amount)} руб.`;

  try {
    const result = await sendTelegramDocumentTo(lead.telegram_chat_id, file, caption);
    db.prepare(
      "UPDATE invoices SET status = 'sent', telegram_message_id = ?, last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).run(result.messageId, invoiceId);
    db.prepare(
      `
      INSERT INTO messages
        (id, lead_id, manager_id, direction, sender_type, body, attachment_file_id, attachment_file_name,
         attachment_mime, telegram_message_id, status)
      VALUES (?, ?, ?, 'out', 'manager', ?, ?, ?, 'application/pdf', ?, 'sent')
    `,
    ).run(
      randomUUID(),
      invoice.lead_id,
      invoice.manager_id,
      caption,
      result.fileId ?? null,
      fileName,
      result.messageId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      "UPDATE invoices SET status = 'failed', last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    ).run(message, invoiceId);
    throw new Error(message);
  }

  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow;
}
