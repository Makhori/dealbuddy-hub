import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/useMe";
import {
  LEAD_STATUSES,
  money,
  monthLabel,
  monthRange,
  payroll,
  statusMeta,
} from "@/lib/crm";
import { useDefaultPeriod } from "@/hooks/usePeriod";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { Lead } from "./board";
import type { Payment } from "./payments";

export const Route = createFileRoute("/_authenticated/desk")({
  head: () => ({
    meta: [
      { title: "Рабочий стол менеджера — план и премия | Pulse CRM" },
      {
        name: "description",
        content:
          "Личный рабочий стол менеджера: заявки на сегодня, выполнение плана, начисленная премия и остаток до коэффициента.",
      },
      { property: "og:title", content: "Рабочий стол менеджера" },
      {
        property: "og:description",
        content: "Свои заявки, факт по плану и расчёт премии в реальном времени.",
      },
    ],
  }),
  component: DeskPage,
});

function DeskPage() {
  const { data: me } = useMe();
  const period = useDefaultPeriod();
  const { from, to } = monthRange(period);
  const employeeId = me?.employee?.id ?? null;

  const { data: leads = [] } = useQuery({
    queryKey: ["leads", "desk", employeeId],
    enabled: !!me,
    queryFn: async () => {
      let q = supabase.from("leads").select("*");
      if (employeeId) q = q.eq("manager_id", employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Lead[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", "desk", employeeId, period],
    enabled: !!me,
    queryFn: async () => {
      let q = supabase
        .from("payments")
        .select("*")
        .gte("payment_date", from)
        .lt("payment_date", to);
      if (employeeId) q = q.eq("manager_id", employeeId);
      const { data, error } = await q;
      if (error) throw error;
      return data as Payment[];
    },
  });

  const { data: plan } = useQuery({
    queryKey: ["plan", employeeId, period],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data } = await supabase
        .from("plans")
        .select("*")
        .eq("period", period)
        .eq("employee_id", employeeId!)
        .maybeSingle();
      return data as
        | { plan_min: number; plan_target: number; plan_max: number }
        | null;
    },
  });

  const emp = me?.employee;
  const fact = payments.reduce((a, p) => a + Number(p.net_profit), 0);
  const calc = payroll({
    salary: Number(emp?.salary ?? 0),
    baseRate: Number(emp?.base_rate ?? 0),
    minCoef: Number(emp?.min_coef ?? 1),
    targetCoef: Number(emp?.target_coef ?? 1),
    planMin: Number(plan?.plan_min ?? 0),
    planTarget: Number(plan?.plan_target ?? 0),
    fact,
  });

  const today = new Date().toISOString().slice(0, 10);
  const todayLeads = leads.filter((l) => l.lead_date === today);
  const active = leads.filter((l) => !["won", "lost"].includes(l.status));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          Привет, {emp?.full_name ?? me?.email}
        </h1>
        <p className="text-sm text-muted-foreground">
          Рабочий стол за {monthLabel(period)}
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Stat label="Чистыми за месяц" value={money(fact)} accent />
        <Stat label="Начислена премия" value={money(calc.bonus)} />
        <Stat
          label="К выплате (оклад + премия)"
          value={money(calc.payout)}
        />
        <Stat label="Текущий коэффициент" value={calc.coefLabel} />
      </div>

      <section className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Выполнение плана</h2>
          <span className="num text-sm text-muted-foreground">
            {money(fact)} из {money(Number(plan?.plan_target ?? 0))}
          </span>
        </div>
        <Progress value={calc.progressTarget} />
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniPlan
            label="План-минимум"
            plan={Number(plan?.plan_min ?? 0)}
            left={calc.toMin}
            coef={Number(emp?.min_coef ?? 1)}
          />
          <MiniPlan
            label="Целевой план"
            plan={Number(plan?.plan_target ?? 0)}
            left={calc.toTarget}
            coef={Number(emp?.target_coef ?? 1)}
          />
          <MiniPlan
            label="План-максимум"
            plan={Number(plan?.plan_max ?? 0)}
            left={Math.max(Number(plan?.plan_max ?? 0) - fact, 0)}
            coef={Number(emp?.target_coef ?? 1)}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Заявки на сегодня</h2>
            <Button asChild variant="secondary" size="sm">
              <Link to="/board">Открыть доску</Link>
            </Button>
          </div>
          <ul className="mt-3 space-y-2">
            {todayLeads.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Сегодня новых заявок нет — в работе {active.length} шт.
              </li>
            )}
            {todayLeads.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{l.client_name}</span>
                <span className="text-xs text-muted-foreground">
                  {statusMeta(l.status).title}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface p-5">
          <h2 className="text-lg font-semibold">Моя воронка</h2>
          <ul className="mt-3 space-y-2">
            {LEAD_STATUSES.map((s) => {
              const items = leads.filter((l) => l.status === s.key);
              return (
                <li
                  key={s.key}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{s.title}</span>
                  <span className="num font-semibold">{items.length}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
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
      <p
        className={`num mt-1 text-xl font-bold ${accent ? "text-success" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniPlan({
  label,
  plan,
  left,
  coef,
}: {
  label: string;
  plan: number;
  left: number;
  coef: number;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num text-base font-semibold">{money(plan)}</p>
      <p className="mt-1 text-xs">
        {plan <= 0 ? (
          <span className="text-muted-foreground">план не задан</span>
        ) : left > 0 ? (
          <>
            осталось <span className="num font-semibold">{money(left)}</span> до ×
            {coef}
          </>
        ) : (
          <span className="font-semibold text-success">достигнут ×{coef}</span>
        )}
      </p>
    </div>
  );
}
