import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe } from "@/hooks/useMe";
import { money } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "Оплаты — учёт выручки и чистой прибыли | Pulse CRM" },
      {
        name: "description",
        content:
          "Модуль оплат: сводные карточки, подробная таблица платежей и ручное добавление новых оплат.",
      },
      { property: "og:title", content: "Модуль оплат" },
      {
        property: "og:description",
        content: "Выручка, чистая прибыль и дебиторка по каждой сделке.",
      },
    ],
  }),
  component: PaymentsPage,
});

export type Payment = {
  id: string;
  order_no: number | null;
  client_name: string;
  contact: string | null;
  tariff: string | null;
  revenue: number;
  net_profit: number;
  receivable: number | null;
  payment_method: string | null;
  payment_date: string;
  manager_id: string | null;
  schedule_note: string | null;
};

export function usePayments() {
  return useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data as Payment[];
    },
  });
}

function PaymentsPage() {
  const { data: payments = [], isLoading } = usePayments();
  const { data: employees = [] } = useEmployees();
  const { data: me } = useMe();
  const [manager, setManager] = useState("all");
  const [search, setSearch] = useState("");

  const nameOf = (id: string | null) =>
    employees.find((e) => e.id === id)?.full_name ?? "—";

  const rows = useMemo(
    () =>
      payments.filter(
        (p) =>
          (manager === "all" || p.manager_id === manager) &&
          (search.trim() === "" ||
            p.client_name.toLowerCase().includes(search.toLowerCase())),
      ),
    [payments, manager, search],
  );

  const revenue = rows.reduce((a, p) => a + Number(p.revenue), 0);
  const net = rows.reduce((a, p) => a + Number(p.net_profit), 0);
  const receivable = rows.reduce((a, p) => a + Number(p.receivable ?? 0), 0);
  const avg = rows.length ? revenue / rows.length : 0;

  const cards = [
    { label: "Выручка", value: money(revenue), tone: "text-foreground" },
    { label: "Чистая прибыль", value: money(net), tone: "text-success" },
    { label: "Дебиторка", value: money(receivable), tone: "text-warning-foreground" },
    { label: "Средний чек", value: money(avg), tone: "text-foreground" },
    { label: "Оплат", value: String(rows.length), tone: "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Оплаты</h1>
          <p className="text-sm text-muted-foreground">
            Все оплаченные сделки{me?.isAdmin ? " отдела" : ""} с деталями по каждому клиенту
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder="Поиск клиента…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52"
          />
          {me?.isAdmin && (
            <Select value={manager} onValueChange={setManager}>
              <SelectTrigger className="w-48">
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
          <NewPaymentDialog />
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="surface p-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`num mt-1 text-xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="surface overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead>Тариф</TableHead>
              <TableHead className="text-right">Выручка</TableHead>
              <TableHead className="text-right">Чистыми</TableHead>
              <TableHead className="text-right">Дебиторка</TableHead>
              <TableHead>Способ</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead>Менеджер</TableHead>
              <TableHead>График</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={11}>Загружаем…</TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="num">{p.order_no ?? "—"}</TableCell>
                <TableCell className="font-medium">{p.client_name}</TableCell>
                <TableCell className="max-w-40 truncate text-muted-foreground">
                  {p.contact ?? "—"}
                </TableCell>
                <TableCell className="max-w-40 truncate">
                  {p.tariff ?? "—"}
                </TableCell>
                <TableCell className="num text-right">
                  {money(p.revenue)}
                </TableCell>
                <TableCell className="num text-right font-semibold text-success">
                  {money(p.net_profit)}
                </TableCell>
                <TableCell className="num text-right">
                  {p.receivable ? money(p.receivable) : "—"}
                </TableCell>
                <TableCell>{p.payment_method ?? "—"}</TableCell>
                <TableCell className="num">{p.payment_date}</TableCell>
                <TableCell>{nameOf(p.manager_id)}</TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  {p.schedule_note ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function NewPaymentDialog() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    client_name: "",
    contact: "",
    tariff: "",
    revenue: "",
    net_profit: "",
    receivable: "",
    payment_method: "",
    payment_date: new Date().toISOString().slice(0, 10),
    manager_id: "",
    schedule_note: "",
  });

  const managerId = f.manager_id || me?.employee?.id || "";

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payments").insert({
        client_name: f.client_name,
        contact: f.contact || null,
        tariff: f.tariff || null,
        revenue: Number(f.revenue || 0),
        net_profit: Number(f.net_profit || f.revenue || 0),
        receivable: f.receivable ? Number(f.receivable) : null,
        payment_method: f.payment_method || null,
        payment_date: f.payment_date,
        manager_id: managerId || null,
        schedule_note: f.schedule_note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Оплата добавлена");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Внести оплату
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая оплата</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Клиент</Label>
              <Input
                value={f.client_name}
                onChange={(e) => setF({ ...f, client_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Контакт</Label>
              <Input
                value={f.contact}
                onChange={(e) => setF({ ...f, contact: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Тариф</Label>
            <Input
              value={f.tariff}
              onChange={(e) => setF({ ...f, tariff: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Выручка</Label>
              <Input
                type="number"
                value={f.revenue}
                onChange={(e) => setF({ ...f, revenue: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Чистыми</Label>
              <Input
                type="number"
                value={f.net_profit}
                onChange={(e) => setF({ ...f, net_profit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дебиторка</Label>
              <Input
                type="number"
                value={f.receivable}
                onChange={(e) => setF({ ...f, receivable: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Способ оплаты</Label>
              <Input
                value={f.payment_method}
                onChange={(e) => setF({ ...f, payment_method: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата оплаты</Label>
              <Input
                type="date"
                value={f.payment_date}
                onChange={(e) => setF({ ...f, payment_date: e.target.value })}
              />
            </div>
          </div>
          {me?.isAdmin && (
            <div className="space-y-1.5">
              <Label>Менеджер</Label>
              <Select
                value={managerId}
                onValueChange={(v) => setF({ ...f, manager_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>График платежей / комментарий</Label>
            <Input
              value={f.schedule_note}
              onChange={(e) => setF({ ...f, schedule_note: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => create.mutate()}
            disabled={!f.client_name || create.isPending}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
