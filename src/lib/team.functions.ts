import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) {
      throw new Error("Только руководитель может добавлять сотрудников");
    }

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (created.error) throw new Error(created.error.message);
    const userId = created.data.user!.id;

    const { error: empError } = await supabaseAdmin.from("employees").insert({
      user_id: userId,
      full_name: data.full_name,
      email: data.email,
      position_title: data.position_title,
      salary: data.salary,
      base_rate: data.base_rate,
      min_coef: data.min_coef,
      target_coef: data.target_coef,
    });
    if (empError) throw new Error(empError.message);

    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: userId,
      role: data.is_admin ? "admin" : "manager",
    });
    if (roleError) throw new Error(roleError.message);

    return { ok: true };
  });
