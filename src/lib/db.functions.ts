import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const token = z.string().nullable();

export const loginServer = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { login } = await import("./sqlite.server");
    return login(data.email, data.password);
  });

export const getSessionServer = createServerFn({ method: "POST" })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const { session } = await import("./sqlite.server");
    return session(data.token);
  });

export const logoutServer = createServerFn({ method: "POST" })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const { logout } = await import("./sqlite.server");
    logout(data.token);
    return { ok: true };
  });

const querySchema = z.object({
  token,
  table: z.enum([
    "user_roles",
    "employees",
    "leads",
    "messages",
    "invoices",
    "payments",
    "plans",
    "employee_terms",
  ]),
  action: z.enum(["select", "insert", "update", "delete", "upsert"]),
  columns: z.string().optional(),
  payload: z
    .union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
    .optional(),
  filters: z
    .array(
      z.object({
        op: z.enum(["eq", "neq", "gte", "lt"]),
        column: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  order: z
    .object({ column: z.string(), ascending: z.boolean(), nullsFirst: z.boolean().optional() })
    .optional(),
  limit: z.number().int().positive().optional(),
  single: z.enum(["single", "maybe"]).optional(),
  onConflict: z.string().optional(),
});

export const queryServer = createServerFn({ method: "POST" })
  .validator(querySchema)
  .handler(async ({ data }) => {
    const { executeQuery } = await import("./sqlite.server");
    return executeQuery(data);
  });

export const syncGoogleSheetsServer = createServerFn({ method: "POST" })
  .validator(z.object({ token }))
  .handler(async ({ data }) => {
    const { syncGoogleSheets } = await import("./sqlite.server");
    return syncGoogleSheets(data.token);
  });

const saveInvoiceSchema = z.object({
  token,
  id: z.string().nullable(),
  leadId: z.string(),
  description: z.string(),
  amount: z.number(),
  issueDate: z.string(),
  dueDate: z.string().nullable(),
});

export const saveInvoiceServer = createServerFn({ method: "POST" })
  .validator(saveInvoiceSchema)
  .handler(async ({ data }) => {
    const { saveInvoice } = await import("./sqlite.server");
    return saveInvoice(data.token, {
      id: data.id,
      leadId: data.leadId,
      description: data.description,
      amount: data.amount,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
    });
  });

export const sendInvoiceServer = createServerFn({ method: "POST" })
  .validator(z.object({ token, invoiceId: z.string() }))
  .handler(async ({ data }) => {
    const { sendInvoice } = await import("./sqlite.server");
    return sendInvoice(data.token, data.invoiceId);
  });
