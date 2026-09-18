import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { db as supabase } from "@/lib/db-client";
import { useMe } from "@/hooks/useMe";
import { useTerms } from "@/hooks/useTerms";
import {
  LEAD_STATUSES,
  money,
  monthLabel,
  monthRange,
  payroll,
  statusMeta,
  termsFor,
} from "@/lib/crm";
import { useFilters } from "@/components/filters";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import type { Lead } from "./board";
import type { Payment } from "./payments";

export const Route = createFileRoute("/_authenticated/desk")({
  head: () => ({
    meta: [
      { title: "Рабочий стол менеджера — план и премия | Pulse CRM" },
      {
        name: "description",
        content:
          "Личный рабочий стол менеджера: текущая премия, остаток до повышающего коэффициента и заявки в работе.",
      },
      { property: "og:title", content: "Рабочий стол менеджера" },
      {
        property: "og:description",
        content: "Премия в реальном времени, план и заявки в работе.",
      },
    ],
  }),
  component: DeskPage,
});

function DeskPage() {
  const { data: me } = useMe();
  const f = useFilters();
  const period = f.period;
  const { from, to } = monthRange(period);
  const employeeId = me?.employee?.id ?? null;
  const { data: terms = [] } = useTerms(period);

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
  const t = emp
    ? termsFor(emp, terms, period)
    : { salary: 0, base_rate: 0, min_coef: 1, target_coef: 1 };
  const fact = payments.reduce((a, p) => a + Number(p.net_profit), 0);
  const planMin = Number(plan?.plan_min ?? 0);
  const planTarget = Number(plan?.plan_target ?? 0);
  const calc = payroll({
    salary: t.salary,
    baseRate: t.base_rate,
    minCoef: t.min_coef,
    targetCoef: t.target_coef,
    planMin,
    planTarget,
    fact,
  });

  const next =
    planMin > 0 && fact < planMin
      ? { label: "план-минимум", value: planMin, coef: t.min_coef }
      : planTarget > 0 && fact < planTarget
        ? { label: "целевой план", value: planTarget, coef: t.target_coef }
        : null;
  const bonusAtNext = next ? (next.value * t.base_rate) / 100 * next.coef : 0;
  const scale = Math.max(planTarget, planMin, fact, 1);

  const active = leads.filter((l) => !["won", "lost"].includes(l.status));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            Привет, {emp?.full_name ?? me?.email}
          </h1>
          <p className="text-xs text-muted-foreground">
            Рабочий стол за {monthLabel(period)}
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to="/board" search={{ q: "" }}>
            Открыть доску <ArrowRight className="size-4" />
          </Link>
        </Button>
      </header>

      <section className="surface grid shrink-0 gap-5 p-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs text-muted-foreground">
                Ваша премия на сейчас
              </p>
              <p className="num text-4xl font-bold text-success">
                {money(calc.bonus)}
              </p>
            </div>
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">
              {planTarget || planMin ? calc.coefLabel : "план не задан"}
            </span>
          </div>

          <div className="space-y-2">
            <Progress
              value={Math.min((fact / scale) * 100, 100)}
              className="h-3"
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Сделано чистыми{" "}
                <span className="num font-semibold text-foreground">
                  {money(fact)}
                </span>
              </span>
              <span>
                Минимум{" "}
                <span className="num font-semibold text-foreground">
                  {money(planMin)}
                </span>{" "}
                · Цель{" "}
                <span className="num font-semibold text-foreground">
                  {money(planTarget)}
                </span>
              </span>
            </div>
            <p className="text-sm">
              {next ? (
                <>
                  До <b>{next.label}</b> осталось{" "}
                  <span className="num font-semibold">
                    {money(next.value - fact)}
                  </span>{" "}
                  — премия вырастет до{" "}
                  <span className="num font-semibold text-success">
                    {money(bonusAtNext)}
                  </span>{" "}
                  (коэффициент ×{next.coef})
                </>
              ) : planTarget > 0 ? (
                <span className="font-semibold text-success">
                  Целевой план выполнен — работает максимальный коэффициент ×
                  {t.target_coef}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Планы на этот месяц ещё не выставлены руководителем.
                </span>
              )}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 self-center">
          <Mini label="К выплате" value={money(calc.payout)} strong />
          <Mini label="Оклад" value={money(t.salary)} />
          <Mini label="Ставка премии" value={`${t.base_rate}%`} />
          <Mini label="Оплат за месяц" value={String(payments.length)} />
        </dl>
      </section>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="surface flex min-h-0 flex-col p-4">
          <div className="flex shrink-0 items-center justify-between pb-2">
            <h2 className="text-base font-semibold">
              В работе · {active.length}
            </h2>
            <span className="text-xs text-muted-foreground">
              нажмите карточку — откроется на доске
            </span>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {active.length === 0 && (
              <li className="text-sm text-muted-foreground">
                Активных заявок нет.
              </li>
            )}
            {active.map((l) => (
              <li key={l.id}>
                <Link
                  to="/board"
                  search={{ q: l.client_name }}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {l.client_name}
                    </span>
                    {l.tariff && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {l.tariff}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    {statusMeta(l.status).title}
                    <ArrowRight className="size-3.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="surface flex min-h-0 flex-col p-4">
          <h2 className="shrink-0 pb-2 text-base font-semibold">Моя воронка</h2>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {LEAD_STATUSES.map((s) => {
              const items = leads.filter((l) => l.status === s.key);
              return (
                <li key={s.key}>
                  <Link
                    to="/board"
                    search={{ q: "" }}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <span>{s.title}</span>
                    <span className="num font-semibold">{items.length}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`num mt-0.5 font-bold ${strong ? "text-lg" : "text-base"}`}
      >
        {value}
      </dd>
    </div>
  );
}
