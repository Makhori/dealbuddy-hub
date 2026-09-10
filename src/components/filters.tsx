import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe } from "@/hooks/useMe";
import { useDefaultPeriod } from "@/hooks/usePeriod";
import { monthLabel, monthStart } from "@/lib/crm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

type Filterable = {
  manager_id?: string | null;
  tariff?: string | null;
  payment_method?: string | null;
};

type FiltersValue = {
  period: string;
  setPeriod: (v: string) => void;
  manager: string;
  setManager: (v: string) => void;
  tariff: string;
  setTariff: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  active: boolean;
  reset: () => void;
  match: (row: Filterable) => boolean;
  matchManager: (row: Filterable) => boolean;
};

const Ctx = createContext<FiltersValue | null>(null);

export function useFilters() {
  const v = useContext(Ctx);
  if (!v) throw new Error("FiltersProvider отсутствует");
  return v;
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ["filter-options"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [pays, leads, plans] = await Promise.all([
        supabase.from("payments").select("tariff,payment_method,payment_date"),
        supabase.from("leads").select("tariff,payment_method"),
        supabase.from("plans").select("period"),
      ]);
      const months = new Set<string>([monthStart()]);
      (pays.data ?? []).forEach((p) => {
        if (p.payment_date)
          months.add(String(p.payment_date).slice(0, 8) + "01");
      });
      (plans.data ?? []).forEach((p) => {
        if (p.period) months.add(String(p.period));
      });
      const tariffs = new Set<string>();
      const methods = new Set<string>();
      [...(pays.data ?? []), ...(leads.data ?? [])].forEach((r) => {
        const rec = r as {
          tariff?: string | null;
          payment_method?: string | null;
        };
        if (rec.tariff) tariffs.add(rec.tariff);
        if (rec.payment_method) methods.add(rec.payment_method);
      });
      return {
        months: [...months].sort().reverse(),
        tariffs: [...tariffs].sort((a, b) => a.localeCompare(b, "ru")),
        methods: [...methods].sort((a, b) => a.localeCompare(b, "ru")),
      };
    },
  });
}

export function FiltersProvider({ children }: { children: ReactNode }) {
  const defaultPeriod = useDefaultPeriod();
  const [period, setPeriod] = useState<string | null>(null);
  const [manager, setManager] = useState("all");
  const [tariff, setTariff] = useState("all");
  const [method, setMethod] = useState("all");

  const value = useMemo<FiltersValue>(() => {
    const matchManager = (row: Filterable) =>
      manager === "all" || row.manager_id === manager;
    return {
      period: period ?? defaultPeriod,
      setPeriod,
      manager,
      setManager,
      tariff,
      setTariff,
      method,
      setMethod,
      active: manager !== "all" || tariff !== "all" || method !== "all",
      reset: () => {
        setManager("all");
        setTariff("all");
        setMethod("all");
      },
      matchManager,
      match: (row: Filterable) =>
        matchManager(row) &&
        (tariff === "all" || row.tariff === tariff) &&
        (method === "all" || row.payment_method === method),
    };
  }, [period, defaultPeriod, manager, tariff, method]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function FilterBar() {
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const { data: options } = useFilterOptions();
  const f = useFilters();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={f.period} onValueChange={f.setPeriod}>
        <SelectTrigger className="h-9 w-44" aria-label="Месяц">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(options?.months ?? [f.period]).map((m) => (
            <SelectItem key={m} value={m}>
              {monthLabel(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {me?.isAdmin && (
        <Select value={f.manager} onValueChange={f.setManager}>
          <SelectTrigger className="h-9 w-40" aria-label="Менеджер">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все менеджеры</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Select value={f.tariff} onValueChange={f.setTariff}>
        <SelectTrigger className="h-9 w-44" aria-label="Тариф">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value="all">Все тарифы</SelectItem>
          {(options?.tariffs ?? []).map((t) => (
            <SelectItem key={t} value={t}>
              <span className="block max-w-56 truncate">{t}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={f.method} onValueChange={f.setMethod}>
        <SelectTrigger className="h-9 w-40" aria-label="Способ оплаты">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все способы оплаты</SelectItem>
          {(options?.methods ?? []).map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {f.active && (
        <Button variant="ghost" size="sm" onClick={f.reset}>
          <RotateCcw className="size-4" /> Сбросить
        </Button>
      )}
    </div>
  );
}
