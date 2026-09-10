import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe, type Employee } from "@/hooks/useMe";
import { money, monthRange, monthStart, payroll } from "@/lib/crm";
import { createEmployeeAccount } from "@/lib/team.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import type { Payment } from "./payments";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Сотрудники — оклады, ставки и коэффициенты | Pulse CRM" },
      {
        name: "description",
        content:
          "Добавление сотрудников отдела продаж, настройка оклада, базовой ставки премии и повышающих коэффициентов.",
      },
      { property: "og:title", content: "Сотрудники отдела продаж" },
      {
        property: "og:description",
        content: "Оклады, ставки, коэффициенты и фактическая премия каждого менеджера.",
      },
    ],
  }),
  component: TeamPage,
});

function TeamPage() {
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const period = monthStart();
  const { from, to } = monthRange(period);

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
      }[];
    },
  });

  if (me && !me.isAdmin)
    return (
      <p className="text-sm text-muted-foreground">
        Раздел доступен только руководителю.
      </p>
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Сотрудники</h1>
          <p className="text-sm text-muted-foreground">
            Оклады, ставки, коэффициенты и расчёт премии за текущий месяц
          </p>
        </div>
        <NewEmployeeDialog />
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {employees.map((e) => {
          const fact = payments
            .filter((p) => p.manager_id === e.id)
            .reduce((a, p) => a + Number(p.net_profit), 0);
          const plan = plans.find((p) => p.employee_id === e.id);
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
            <EmployeeCard key={e.id} employee={e} fact={fact} calc={calc} />
          );
        })}
      </div>
    </div>
  );
}

function EmployeeCard({
  employee,
  fact,
  calc,
}: {
  employee: Employee;
  fact: number;
  calc: ReturnType<typeof payroll>;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    full_name: employee.full_name,
    position_title: employee.position_title,
    salary: String(employee.salary),
    base_rate: String(employee.base_rate),
    min_coef: String(employee.min_coef),
    target_coef: String(employee.target_coef),
    is_active: employee.is_active,
  });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("employees")
        .update({
          full_name: f.full_name,
          position_title: f.position_title,
          salary: Number(f.salary || 0),
          base_rate: Number(f.base_rate || 0),
          min_coef: Number(f.min_coef || 1),
          target_coef: Number(f.target_coef || 1),
          is_active: f.is_active,
        })
        .eq("id", employee.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Данные сотрудника обновлены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="surface space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{employee.full_name}</h2>
          <p className="text-xs text-muted-foreground">{employee.email}</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span>{f.is_active ? "Работает" : "Отключён"}</span>
          <Switch
            checked={f.is_active}
            onCheckedChange={(v) => setF({ ...f, is_active: v })}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Имя" value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} />
        <Field
          label="Должность"
          value={f.position_title}
          onChange={(v) => setF({ ...f, position_title: v })}
        />
        <Field
          label="Оклад, ₽"
          type="number"
          value={f.salary}
          onChange={(v) => setF({ ...f, salary: v })}
        />
        <Field
          label="Базовая ставка премии, %"
          type="number"
          value={f.base_rate}
          onChange={(v) => setF({ ...f, base_rate: v })}
        />
        <Field
          label="Коэффициент за план-минимум"
          type="number"
          value={f.min_coef}
          onChange={(v) => setF({ ...f, min_coef: v })}
        />
        <Field
          label="Коэффициент за целевой план"
          type="number"
          value={f.target_coef}
          onChange={(v) => setF({ ...f, target_coef: v })}
        />
      </div>

      <div className="grid gap-2 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-4">
        <Info label="Факт чистыми" value={money(fact)} />
        <Info label="Коэффициент" value={calc.coefLabel} />
        <Info label="Премия" value={money(calc.bonus)} />
        <Info label="К выплате" value={money(calc.payout)} />
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>
        Сохранить
      </Button>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
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

function NewEmployeeDialog() {
  const qc = useQueryClient();
  const create = useServerFn(createEmployeeAccount);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    full_name: "",
    email: "",
    password: "",
    position_title: "Менеджер по продажам",
    salary: "0",
    base_rate: "5",
    min_coef: "1.2",
    target_coef: "1.5",
    is_admin: false,
  });

  const mutation = useMutation({
    mutationFn: async () =>
      create({
        data: {
          full_name: f.full_name,
          email: f.email,
          password: f.password,
          position_title: f.position_title,
          salary: Number(f.salary || 0),
          base_rate: Number(f.base_rate || 0),
          min_coef: Number(f.min_coef || 1),
          target_coef: Number(f.target_coef || 1),
          is_admin: f.is_admin,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Сотрудник добавлен, доступ создан");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Новый сотрудник
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый сотрудник</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Имя" value={f.full_name} onChange={(v) => setF({ ...f, full_name: v })} />
            <Field label="Должность" value={f.position_title} onChange={(v) => setF({ ...f, position_title: v })} />
            <Field label="Почта для входа" value={f.email} onChange={(v) => setF({ ...f, email: v })} />
            <Field label="Пароль" value={f.password} onChange={(v) => setF({ ...f, password: v })} />
            <Field label="Оклад, ₽" type="number" value={f.salary} onChange={(v) => setF({ ...f, salary: v })} />
            <Field label="Ставка премии, %" type="number" value={f.base_rate} onChange={(v) => setF({ ...f, base_rate: v })} />
            <Field label="Коэф. за минимум" type="number" value={f.min_coef} onChange={(v) => setF({ ...f, min_coef: v })} />
            <Field label="Коэф. за цель" type="number" value={f.target_coef} onChange={(v) => setF({ ...f, target_coef: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Права руководителя</p>
              <p className="text-xs text-muted-foreground">
                Видит все заявки, оплаты, планы и премии
              </p>
            </div>
            <Switch
              checked={f.is_admin}
              onCheckedChange={(v) => setF({ ...f, is_admin: v })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => mutation.mutate()}
            disabled={
              !f.full_name || !f.email || f.password.length < 8 || mutation.isPending
            }
          >
            Создать сотрудника
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
