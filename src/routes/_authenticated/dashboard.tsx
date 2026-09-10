import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe } from "@/hooks/useMe";
import {
  compact,
  money,
  monthLabel,
  monthRange,
  monthStart,
  payroll,
} from "@/lib/crm";
import { Progress } from "@/components/ui/progress";
import type { Payment } from "./payments";
import type { Lead } from "./board";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Сводный дашборд отдела продаж | Pulse CRM" },
      {
        name: "description",
        content:
          "Выполнение плана, динамика поступления денег и результаты менеджеров в одном отчёте для руководителя.",
      },
      { property: "og:title", content: "Сводный дашборд отдела продаж" },
      {
        property: "og:description",
        content: "План/факт, динамика выручки и премии команды.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const period = monthStart();
  const { from, to } = monthRange(period);

  const { data: payments = [] } = useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments").select("*");
      if (error) throw error;
      return data as Payment[];
    },
  });

  const { data: leads = [] } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*");
      if (error) throw error;
      return data as Lead[];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["plans", period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("period", period);
      if (error) throw error;
      return data as {
        employee_id: string | null;
        plan_min: number;
        plan_target: number;
        plan_max: number;
      }[];
    },
  });

  if (me && !me.isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        Раздел доступен только руководителю.
      </p>
    );
  }

  const monthPayments = payments.filter(
    (p) => p.payment_date >= from && p.payment_date < to,
  );
  const fact = monthPayments.reduce((a, p) => a + Number(p.net_profit), 0);
  const revenue = monthPayments.reduce((a, p) => a + Number(p.revenue), 0);
  const common = plans.find((p) => !p.employee_id);
  const target = Number(common?.plan_target ?? 0);
  const min = Number(common?.plan_min ?? 0);
  const max = Number(common?.plan_max ?? 0);

  const daily = (() => {
    const map = new Map<string, number>();
    monthPayments.forEach((p) => {
      map.set(p.payment_date, (map.get(p.payment_date) ?? 0) + Number(p.net_profit));
    });
    const days = [...map.keys()].sort();
    let acc = 0;
    return days.map((d) => {
      acc += map.get(d) ?? 0;
      return {
        date: d.slice(8) + "." + d.slice(5, 7),
        day: map.get(d) ?? 0,
        cumulative: acc,
      };
    });
  })();

  const byManager = employees.map((e) => {
    const own = monthPayments.filter((p) => p.manager_id === e.id);
    const empFact = own.reduce((a, p) => a + Number(p.net_profit), 0);
    const plan = plans.find((p) => p.employee_id === e.id);
    const calc = payroll({
      salary: Number(e.salary),
      baseRate: Number(e.base_rate),
      minCoef: Number(e.min_coef),
      targetCoef: Number(e.target_coef),
      planMin: Number(plan?.plan_min ?? 0),
      planTarget: Number(plan?.plan_target ?? 0),
      fact: empFact,
    });
    return { employee: e, fact: empFact, deals: own.length, calc, plan };
  });

  const wonLeads = leads.filter((l) => l.status === "won").length;
  const conversion = leads.length
    ? Math.round((wonLeads / leads.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Сводный дашборд</h1>
        <p className="text-sm text-muted-foreground">
          {monthLabel(period)} · виден только руководителю
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Чистая прибыль, факт" value={money(fact)} accent />
        <Stat label="Выручка" value={money(revenue)} />
        <Stat label="Сделок за месяц" value={String(monthPayments.length)} />
        <Stat label="Конверсия заявок" value={`${conversion}%`} />
      </div>

      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Выполнение общего плана</h2>
          <span className="num text-sm text-muted-foreground">
            {money(fact)} из {money(target)}
          </span>
        </div>
        <Progress value={target ? Math.min((fact / target) * 100, 100) : 0} />
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <PlanCell label="Минимум" value={min} fact={fact} />
          <PlanCell label="Цель" value={target} fact={fact} />
          <PlanCell label="Максимум" value={max} fact={fact} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="surface p-5">
          <h2 className="text-lg font-semibold">Динамика поступления денег</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--color-chart-1)"
                      stopOpacity={0.5}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-chart-1)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v: number) => compact(v / 1000) + "k"}
                />
                <Tooltip
                  formatter={(v: number) => money(v)}
                  labelFormatter={(l) => `Дата: ${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="var(--color-chart-1)"
                  fill="url(#g1)"
                  strokeWidth={2}
                  name="Накопительно"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="text-lg font-semibold">Чистая прибыль по менеджерам</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byManager.map((m) => ({
                  name: m.employee.full_name,
                  fact: m.fact,
                  plan: Number(m.plan?.plan_target ?? 0),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v: number) => compact(v / 1000) + "k"}
                />
                <Tooltip formatter={(v: number) => money(v)} />
                <Bar
                  dataKey="plan"
                  fill="var(--color-chart-2)"
                  name="План"
                  radius={4}
                  opacity={0.35}
                />
                <Bar
                  dataKey="fact"
                  fill="var(--color-chart-1)"
                  name="Факт"
                  radius={4}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="surface p-5">
        <h2 className="text-lg font-semibold">Команда</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {byManager.map((m) => (
            <div key={m.employee.id} className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{m.employee.full_name}</span>
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                  {m.calc.coefLabel}
                </span>
              </div>
              <p className="num mt-2 text-lg font-bold text-success">
                {money(m.fact)}
              </p>
              <Progress className="mt-2" value={m.calc.progressTarget} />
              <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                <Row label="Сделок" value={String(m.deals)} />
                <Row label="Премия" value={money(m.calc.bonus)} />
                <Row label="К выплате" value={money(m.calc.payout)} />
                <Row
                  label="До цели"
                  value={m.calc.toTarget ? money(m.calc.toTarget) : "выполнено"}
                />
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="num font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function PlanCell({
  label,
  value,
  fact,
}: {
  label: string;
  value: number;
  fact: number;
}) {
  const done = value > 0 && fact >= value;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num text-base font-semibold">{money(value)}</p>
      <p className={`text-xs ${done ? "text-success" : "text-muted-foreground"}`}>
        {done ? "достигнут" : `осталось ${money(Math.max(value - fact, 0))}`}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`num mt-1 text-xl font-bold ${accent ? "text-success" : ""}`}>
        {value}
      </p>
    </div>
  );
}
