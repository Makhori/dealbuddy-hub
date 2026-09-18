import { useQuery } from "@tanstack/react-query";
import { db as supabase } from "@/lib/db-client";
import { monthStart } from "@/lib/crm";

/**
 * Период по умолчанию — месяц последней оплаты в базе,
 * чтобы отчёты не открывались на пустом текущем месяце.
 */
export function useDefaultPeriod() {
  const { data } = useQuery({
    queryKey: ["default-period"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("payment_date")
        .order("payment_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const d = data?.payment_date as string | undefined;
      return d ? d.slice(0, 8) + "01" : monthStart();
    },
  });
  return data ?? monthStart();
}
