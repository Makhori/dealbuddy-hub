import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KanbanSquare, Wallet, Target, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Вход в Pulse CRM — заявки, оплаты и премии" },
      {
        name: "description",
        content:
          "Войдите в Pulse CRM: Kanban заявок, модуль оплат, планы продаж и расчёт премий менеджеров.",
      },
      { property: "og:title", content: "Вход в Pulse CRM" },
      {
        property: "og:description",
        content: "Kanban заявок, оплаты, планы и премии отдела продаж.",
      },
    ],
  }),
  component: AuthPage,
});

const DEMO = [
  {
    label: "Руководитель — Вася",
    email: "vasya@crm.local",
    password: "Director2026!",
    note: "видит всех, планы и премии",
  },
  {
    label: "Менеджер — Алина",
    email: "alina@crm.local",
    password: "Manager2026!",
    note: "только свои заявки",
  },
  {
    label: "Менеджер — Паша",
    email: "pasha@crm.local",
    password: "Manager2026!",
    note: "только свои заявки",
  },
];

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEMO[0].email);
  const [password, setPassword] = useState(DEMO[0].password);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/desk" });
    });
  }, [navigate]);

  async function signIn(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(
      creds ?? { email, password },
    );
    setLoading(false);
    if (error) {
      toast.error("Не удалось войти: " + error.message);
      return;
    }
    navigate({ to: "/desk" });
  }

  return (
    <main className="min-h-screen bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="font-display text-2xl font-bold">Pulse CRM</div>
        <div className="space-y-8">
          <h1 className="max-w-md font-display text-4xl leading-tight font-bold">
            Заявки, деньги и премии отдела продаж — на одном экране
          </h1>
          <ul className="space-y-4 text-sm text-sidebar-foreground/80">
            {[
              [KanbanSquare, "Kanban заявок с перетаскиванием статусов"],
              [Wallet, "Модуль оплат: карточки, таблица, ручной ввод"],
              [Target, "Планы минимум / цель / максимум по каждому"],
              [ShieldCheck, "Роли: руководитель видит всё, менеджер — своё"],
            ].map(([Icon, text]) => {
              const I = Icon as typeof KanbanSquare;
              return (
                <li key={text as string} className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-lg bg-sidebar-accent">
                    <I className="size-4 text-sidebar-primary" />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          Данные из вашего файла «Запуск январь-февраль» уже загружены.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold">Вход в систему</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Введите рабочую почту и пароль
            </p>
          </div>

          <form onSubmit={signIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Почта</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Входим…" : "Войти"}
            </Button>
          </form>

          <div className="surface p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Тестовые доступы
            </p>
            <div className="mt-3 space-y-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                    void signIn(undefined, { email: d.email, password: d.password });
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-secondary"
                >
                  <span className="block text-sm font-semibold">{d.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.email} · {d.password} — {d.note}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
