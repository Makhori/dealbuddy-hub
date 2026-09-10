import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe } from "@/hooks/useMe";
import { money, monthLabel, monthRange, payroll } from "@/lib/crm";
import { useDefaultPeriod } from "@/hooks/usePeriod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { Payment } from "./payments";

export const Route = createFileRoute("/_authenticated/plans")({
  head: () => ({
    meta: [
      { title: "Планы и премии отдела продаж | Pulse CRM" },
      {
        name: "description",
        content:
          "Настройка планов минимум, целевой и максимум по отделу и каждому менеджеру с расчётом премий и коэффициентов.",
      },
      { property: "og:title", content: "Планы и премии" },
      {
        property: "og:description",
        content: "План-минимум, целевой и максимум с автоматическим расчётом премии.",
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
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const defaultPeriod = useDefaultPeriod();
  const [customPeriod, setPeriod] = useState<string | null>(null);
  const period = customPeriod ?? defaultPeriod;
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

  const save = useMutation({
    mutationFn: async (p: {
      employee_id: string | null;
      plan_min: number;
      plan_target: number;
      plan_max: number;
    }) => {
      const existing = plans.find((x) =>
        p.employee_id ? x.employee_id === p.employee_id : !x.employee_id,
      );
      if (existing) {
        const { error } = await supabase
          .from("plans")
          .update(p)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("plans").insert({ ...p, period });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      toast.success("План сохранён");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (me && !me.isAdmin)
    return (
      <p className="text-sm text-muted-foreground">
        Раздел доступен только руководителю.
      </p>
    );

  const totalFact = payments.reduce((a, p) => a + Number(p.net_profit), 0);
  const common = plans.find((p) => !p.employee_id) ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Планы и премии</h1>
          <p className="text-sm text-muted-foreground">
            Период: {monthLabel(period)}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="period">Месяц</Label>
          <Input
            id="period"
            type="month"
            value={period.slice(0, 7)}
            onChange={(e) => setPeriod(e.target.value + "-01")}
            className="w-44"
          />
        </div>
      </header>

      <PlanEditor
        title="Общий план отдела"
        subtitle={`Факт: ${money(totalFact)}`}
        plan={common}
        fact={totalFact}
        onSave={(v) => save.mutate({ employee_id: null, ...v })}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {employees.map((e) => {
          const plan = plans.find((p) => p.employee_id === e.id) ?? null;
          const fact = payments
            .filter((p) => p.manager_id === e.id)
            .reduce((a, p) => a + Number(p.net_profit), 0);
          const calc = payroll({
            salary: Number(e.salary),
            baseRate: Number(e.base_rate),
            minCoef: Number(e.min_coef),
            targetCoef: Number(e.target_coef),
            planMin: Number(plan?.plan_min ?? 0),
            planTarget: Number(plan?.plan_target ?? 0),
            fact,
          });
          return (
            <PlanEditor
              key={e.id}
              title={e.full_name}
              subtitle={`${e.position_title} · ставка ${e.base_rate}% · оклад ${money(e.salary)}`}
              plan={plan}
              fact={fact}
              payrollInfo={calc}
              onSave={(v) => save.mutate({ employee_id: e.id, ...v })}
            />
          );
        })}
      </div>
    </div>
  );
}

function PlanEditor({
  title,
  subtitle,
  plan,
  fact,
  payrollInfo,
  onSave,
}: {
  title: string;
  subtitle: string;
  plan: Plan | null;
  fact: number;
  payrollInfo?: ReturnType<typeof payroll>;
  onSave: (v: { plan_min: number; plan_target: number; plan_max: number }) => void;
}) {
  const [v, setV] = useState({
    plan_min: String(plan?.plan_min ?? 0),
    plan_target: String(plan?.plan_target ?? 0),
    plan_max: String(plan?.plan_max ?? 0),
  });
  const [dirty, setDirty] = useState(false);

  const current = dirty
    ? v
    : {
        plan_min: String(plan?.plan_min ?? 0),
        plan_target: String(plan?.plan_target ?? 0),
        plan_max: String(plan?.plan_max ?? 0),
      };

  const target = Number(current.plan_target || 0);

  return (
    <section className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="text-right">
          <p className="num text-lg font-bold text-success">{money(fact)}</p>
          <p className="text-xs text-muted-foreground">факт чистыми</p>
        </div>
      </div>

      <Progress value={target ? Math.min((fact / target) * 100, 100) : 0} />

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["plan_min", "План-минимум"],
            ["plan_target", "Целевой план"],
            ["plan_max", "План-максимум"],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label>{label}</Label>
            <Input
              type="number"
              value={current[key]}
              onChange={(e) => {
                setDirty(true);
                setV({ ...current, [key]: e.target.value });
              }}
            />
          </div>
        ))}
      </div>

      {payrollInfo && (
        <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-4">
          <Info label="Коэффициент" value={payrollInfo.coefLabel} />
          <Info label="Премия" value={money(payrollInfo.bonus)} />
          <Info label="К выплате" value={money(payrollInfo.payout)} />
          <Info
            label="До цели"
            value={payrollInfo.toTarget ? money(payrollInfo.toTarget) : "выполнено"}
          />
        </div>
      )}

      <Button
        onClick={() =>
          onSave({
            plan_min: Number(current.plan_min || 0),
            plan_target: Number(current.plan_target || 0),
            plan_max: Number(current.plan_max || 0),
          })
        }
      >
        Сохранить план
      </Button>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num font-semibold">{value}</p>
    </div>
  );
}
