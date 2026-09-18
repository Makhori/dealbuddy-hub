import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { db as supabase } from "@/lib/db-client";
import { useEmployees, useMe, type Employee } from "@/hooks/useMe";
import { useTerms } from "@/hooks/useTerms";
import { money, monthLabel, monthRange, payroll, termsFor } from "@/lib/crm";
import { useFilters } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Payment } from "./payments";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({
    meta: [
      { title: "Планы и премии отдела продаж | Pulse CRM" },
      {
        name: "description",
        content:
          "Планы минимум, целевой и максимум по месяцам, условия сотрудников и история изменений окладов и коэффициентов.",
      },
      { property: "og:title", content: "Планы и премии" },
      {
        property: "og:description",
        content: "Планы по месяцам, премии и история условий сотрудников.",
      },
    ],
  }),
  component: PlansPage,
});

type Plan = {
  id: string;
  period: string;
  employee_id: string | null;
  plan_min: number;
  plan_target: number;
  plan_max: number;
};

function PlansPage() {
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const f = useFilters();
  const period = f.period;
  const { from, to } = monthRange(period);

  const { data: plans = [] } = useQuery({
    queryKey: ["plans", period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("period", period);
      if (error) throw error;
      return data as Plan[];
    },
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", "period", period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .gte("payment_date", from)
        .lt("payment_date", to);
      if (error) throw error;
      return data as Payment[];
    },
  });

  const { data: terms = [] } = useTerms(period);
  const { data: allTerms = [] } = useTerms();

  if (me && !me.isAdmin)
    return (
      <p className="text-sm text-muted-foreground">
        Раздел доступен только руководителю.
      </p>
    );

  const factOf = (id: string | null) =>
    payments
      .filter((p) => (id ? p.manager_id === id : true))
      .reduce((a, p) => a + Number(p.net_profit), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="shrink-0">
        <h1 className="text-xl font-bold">Планы и премии</h1>
        <p className="text-xs text-muted-foreground">
          Месяц: {monthLabel(period)} — выбирается в фильтре сверху
        </p>
      </header>

      <Tabs
        defaultValue="plans"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <TabsList className="shrink-0 self-start">
          <TabsTrigger value="plans">Планы на месяц</TabsTrigger>
          <TabsTrigger value="terms">Условия сотрудников</TabsTrigger>
        </TabsList>

        <TabsContent
          value="plans"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
        >
          <PlanRow
            title="Общий план отдела"
            subtitle="Все менеджеры вместе"
            period={period}
            plan={plans.find((p) => !p.employee_id) ?? null}
            employeeId={null}
            fact={factOf(null)}
          />
          {employees.map((e) => (
            <PlanRow
              key={e.id}
              title={e.full_name}
              subtitle={e.position_title}
              period={period}
              plan={plans.find((p) => p.employee_id === e.id) ?? null}
              employeeId={e.id}
              fact={factOf(e.id)}
            />
          ))}
        </TabsContent>

        <TabsContent
          value="terms"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
        >
          {employees.map((e) => (
            <TermsRow
              key={e.id}
              employee={e}
              period={period}
              terms={terms}
              plan={plans.find((p) => p.employee_id === e.id) ?? null}
              fact={factOf(e.id)}
            />
          ))}

          <section className="surface p-4">
            <h2 className="text-base font-semibold">История условий</h2>
            <p className="text-xs text-muted-foreground">
              Как менялись оклад, ставка и коэффициенты по месяцам
            </p>
            <div className="mt-3 max-h-72 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Месяц</TableHead>
                    <TableHead>Сотрудник</TableHead>
                    <TableHead className="text-right">Оклад</TableHead>
                    <TableHead className="text-right">Ставка</TableHead>
                    <TableHead className="text-right">Коэф. минимум</TableHead>
                    <TableHead className="text-right">Коэф. цель</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allTerms.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{monthLabel(t.period)}</TableCell>
                      <TableCell>
                        {employees.find((e) => e.id === t.employee_id)
                          ?.full_name ?? "—"}
                      </TableCell>
                      <TableCell className="num text-right">
                        {money(t.salary)}
                      </TableCell>
                      <TableCell className="num text-right">
                        {t.base_rate}%
                      </TableCell>
                      <TableCell className="num text-right">
                        ×{t.min_coef}
                      </TableCell>
                      <TableCell className="num text-right">
                        ×{t.target_coef}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlanRow({
  title,
  subtitle,
  period,
  plan,
  employeeId,
  fact,
}: {
  title: string;
  subtitle: string;
  period: string;
  plan: Plan | null;
  employeeId: string | null;
  fact: number;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    plan_min: String(plan?.plan_min ?? 0),
    plan_target: String(plan?.plan_target ?? 0),
    plan_max: String(plan?.plan_max ?? 0),
  });

  useEffect(() => {
    setV({
      plan_min: String(plan?.plan_min ?? 0),
      plan_target: String(plan?.plan_target ?? 0),
      plan_max: String(plan?.plan_max ?? 0),
    });
  }, [plan, period]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        plan_min: Number(v.plan_min || 0),
        plan_target: Number(v.plan_target || 0),
        plan_max: Number(v.plan_max || 0),
      };
      if (plan) {
        const { error } = await supabase
          .from("plans")
          .update(payload)
          .eq("id", plan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("plans")
          .insert({ ...payload, period, employee_id: employeeId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("План сохранён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const target = Number(v.plan_target || 0);

  return (
    <section className="surface grid items-end gap-3 p-4 lg:grid-cols-[1.2fr_repeat(3,minmax(0,1fr))_auto]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        <p className="num mt-1 text-sm font-bold text-success">
          {money(fact)} факт
        </p>
        <Progress
          className="mt-1.5 h-1.5"
          value={target ? Math.min((fact / target) * 100, 100) : 0}
        />
      </div>
      {(
        [
          ["plan_min", "Минимум"],
          ["plan_target", "Целевой"],
          ["plan_max", "Максимум"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="space-y-1 text-xs text-muted-foreground">
          {label}
          <Input
            type="number"
            value={v[key]}
            onChange={(e) => setV({ ...v, [key]: e.target.value })}
          />
        </label>
      ))}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Сохранить
      </Button>
    </section>
  );
}

function TermsRow({
  employee,
  period,
  terms,
  plan,
  fact,
}: {
  employee: Employee;
  period: string;
  terms: { employee_id: string; period: string; salary: number; base_rate: number; min_coef: number; target_coef: number }[];
  plan: Plan | null;
  fact: number;
}) {
  const qc = useQueryClient();
  const current = termsFor(employee, terms, period);
  const [v, setV] = useState({
    salary: String(current.salary),
    base_rate: String(current.base_rate),
    min_coef: String(current.min_coef),
    target_coef: String(current.target_coef),
  });

  useEffect(() => {
    setV({
      salary: String(current.salary),
      base_rate: String(current.base_rate),
      min_coef: String(current.min_coef),
      target_coef: String(current.target_coef),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, employee.id, terms]);

  const calc = payroll({
    salary: Number(v.salary || 0),
    baseRate: Number(v.base_rate || 0),
    minCoef: Number(v.min_coef || 1),
    targetCoef: Number(v.target_coef || 1),
    planMin: Number(plan?.plan_min ?? 0),
    planTarget: Number(plan?.plan_target ?? 0),
    fact,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        employee_id: employee.id,
        period,
        salary: Number(v.salary || 0),
        base_rate: Number(v.base_rate || 0),
        min_coef: Number(v.min_coef || 1),
        target_coef: Number(v.target_coef || 1),
      };
      const { error } = await supabase
        .from("employee_terms")
        .upsert(payload, { onConflict: "employee_id,period" });
      if (error) throw error;
      const { error: e2 } = await supabase
        .from("employees")
        .update({
          salary: payload.salary,
          base_rate: payload.base_rate,
          min_coef: payload.min_coef,
          target_coef: payload.target_coef,
        })
        .eq("id", employee.id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employee_terms"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Условия на ${monthLabel(period)} сохранены`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="surface grid items-end gap-3 p-4 xl:grid-cols-[1fr_repeat(4,minmax(0,0.8fr))_auto]">
      <div>
        <h2 className="font-semibold">{employee.full_name}</h2>
        <p className="text-xs text-muted-foreground">
          Факт {money(fact)} · {calc.coefLabel}
        </p>
        <p className="num mt-1 text-sm font-bold text-success">
          премия {money(calc.bonus)}
        </p>
        <p className="text-xs text-muted-foreground">
          к выплате {money(calc.payout)}
        </p>
      </div>
      {(
        [
          ["salary", "Оклад, ₽"],
          ["base_rate", "Ставка, %"],
          ["min_coef", "Коэф. минимум"],
          ["target_coef", "Коэф. цель"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="space-y-1 text-xs text-muted-foreground">
          {label}
          <Input
            type="number"
            step="0.1"
            value={v[key]}
            onChange={(e) => setV({ ...v, [key]: e.target.value })}
          />
        </label>
      ))}
      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Сохранить
      </Button>
    </section>
  );
}
