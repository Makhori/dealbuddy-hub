import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireLocalAuth } from "./auth-middleware";

const schema = z.object({
  full_name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  position_title: z.string().min(2),
  salary: z.number().min(0),
  base_rate: z.number().min(0),
  min_coef: z.number().min(1),
  target_coef: z.number().min(1),
  is_admin: z.boolean(),
});

export const createEmployeeAccount = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .validator(schema)
  .handler(async ({ data, context }) => {
    const sqlite = await import("./sqlite.server");
    return sqlite.createEmployeeAccount(context.sessionToken, data);
  });
