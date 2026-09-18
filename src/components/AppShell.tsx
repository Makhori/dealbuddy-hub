import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { db as supabase } from "@/lib/db-client";
import { useMe } from "@/hooks/useMe";
import { Button } from "@/components/ui/button";
import { FilterBar, FiltersProvider } from "@/components/filters";
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
    <FiltersProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <aside className="hidden w-56 shrink-0 flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground lg:flex">
          <span className="font-display text-lg font-bold">Pulse CRM</span>
          <nav className="flex flex-col gap-1">
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

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
            <nav className="flex gap-1 overflow-x-auto lg:hidden">
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium ${
                    path === item.to
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <FilterBar />
          </header>

          <main className="min-h-0 flex-1 overflow-hidden p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </FiltersProvider>
  );
}
