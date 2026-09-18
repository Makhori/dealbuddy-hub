import { useQuery } from "@tanstack/react-query";
import { db as supabase } from "@/lib/db-client";

export type EmployeeTerm = {
  id: string;
  employee_id: string;
  period: string;
  salary: number;
  base_rate: number;
  min_coef: number;
  target_coef: number;
};

/** Условия (оклад, ставка, коэффициенты) сотрудников по месяцам. */
export function useTerms(period?: string) {
  return useQuery({
    queryKey: ["employee_terms", period ?? "all"],
    queryFn: async () => {
      let q = supabase.from("employee_terms").select("*").order("period", {
        ascending: false,
      });
      if (period) q = q.eq("period", period);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmployeeTerm[];
    },
  });
}
