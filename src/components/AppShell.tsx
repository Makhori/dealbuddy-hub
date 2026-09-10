import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/useMe";
import { Button } from "@/components/ui/button";
import {
  KanbanSquare,
  Wallet,
  LayoutDashboard,
  Target,
  Users,
  LogOut,
  Briefcase,
} from "lucide-react";

const NAV = [
  { to: "/desk", label: "Рабочий стол", icon: Briefcase, admin: false },
  { to: "/board", label: "Заявки", icon: KanbanSquare, admin: false },
  { to: "/payments", label: "Оплаты", icon: Wallet, admin: false },
  { to: "/dashboard", label: "Дашборд", icon: LayoutDashboard, admin: true },
  { to: "/plans", label: "Планы и премии", icon: Target, admin: true },
  { to: "/team", label: "Сотрудники", icon: Users, admin: true },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  const items = NAV.filter((n) => !n.admin || me?.isAdmin);

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="flex flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground lg:min-h-screen">
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-bold">Pulse CRM</span>
        </div>
        <nav className="flex flex-wrap gap-1 lg:flex-col">
          {items.map((item) => {
            const Icon = item.icon;
            const active = path === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3 border-t border-sidebar-border pt-4">
          <div className="text-sm">
            <div className="font-semibold">
              {me?.employee?.full_name ?? me?.email}
            </div>
            <div className="text-xs text-sidebar-foreground/60">
              {me?.isAdmin ? "Руководитель" : "Менеджер по продажам"}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={async () => {
              await supabase.auth.signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="size-4" /> Выйти
          </Button>
        </div>
      </aside>
      <main className="p-4 lg:p-8">{children}</main>
    </div>
  );
}
