import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useMe } from "@/hooks/useMe";
import { LEAD_STATUSES, money, statusMeta, type LeadStatus } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Phone, Send, GripVertical } from "lucide-react";

export const Route = createFileRoute("/_authenticated/board")({
  head: () => ({
    meta: [
      { title: "Заявки — Kanban воронка продаж | Pulse CRM" },
      {
        name: "description",
        content:
          "Kanban-доска заявок: новая, в работе, КП отправлено, оплата и отказ. Перетаскивайте карточки между статусами.",
      },
      { property: "og:title", content: "Kanban воронка заявок" },
      {
        property: "og:description",
        content: "Все заявки отдела продаж по статусам с drag-and-drop.",
      },
    ],
  }),
  component: BoardPage,
});

export type Lead = {
  id: string;
  lead_date: string | null;
  client_name: string;
  phone: string | null;
  telegram: string | null;
  income: string | null;
  request: string | null;
  status: string;
  tariff: string | null;
  amount: number | null;
  net_amount: number | null;
  comment: string | null;
  next_action: string | null;
  manager_id: string | null;
};

function BoardPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const [manager, setManager] = useState("all");
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("lead_date", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data as Lead[];
    },
  });

  const nameOf = (id: string | null) =>
    employees.find((e) => e.id === id)?.full_name ?? "—";

  const filtered = useMemo(
    () =>
      leads.filter(
        (l) =>
          (manager === "all" || l.manager_id === manager) &&
          (search.trim() === "" ||
            (l.client_name + " " + (l.telegram ?? "") + " " + (l.phone ?? ""))
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [leads, manager, search],
  );

  const move = useMutation({
    mutationFn: async ({ lead, status }: { lead: Lead; status: LeadStatus }) => {
      const { error } = await supabase
        .from("leads")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", lead.id);
      if (error) throw error;

      if (status === "won") {
        const { data: exists } = await supabase
          .from("payments")
          .select("id")
          .eq("lead_id", lead.id)
          .maybeSingle();
        if (!exists) {
          const revenue = Number(lead.amount ?? 0);
          const net = Number(lead.net_amount ?? revenue);
          const { error: pe } = await supabase.from("payments").insert({
            client_name: lead.client_name,
            contact: lead.telegram ?? lead.phone,
            tariff: lead.tariff,
            revenue,
            net_profit: net,
            payment_date: new Date().toISOString().slice(0, 10),
            manager_id: lead.manager_id,
            lead_id: lead.id,
          });
          if (pe) throw pe;
          return { createdPayment: true };
        }
      }
      return { createdPayment: false };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      if (r.createdPayment) toast.success("Заявка добавлена в модуль оплат");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Заявки</h1>
          <p className="text-sm text-muted-foreground">
            {me?.isAdmin
              ? "Все заявки отдела. Перетащите карточку, чтобы сменить статус."
              : "Ваши заявки. Перетащите карточку, чтобы сменить статус."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по клиенту…"
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
          <NewLeadDialog />
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Загружаем заявки…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {LEAD_STATUSES.map((col) => {
            const items = filtered.filter((l) => l.status === col.key);
            const sum = items.reduce(
              (a, l) => a + Number(l.net_amount ?? 0),
              0,
            );
            return (
              <section
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.key);
                }}
                onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
                onDrop={() => {
                  setOver(null);
                  const lead = leads.find((l) => l.id === dragId);
                  setDragId(null);
                  if (lead && lead.status !== col.key)
                    move.mutate({ lead, status: col.key });
                }}
                className={`flex min-h-40 flex-col gap-3 rounded-xl border p-3 transition-colors ${
                  over === col.key
                    ? "border-primary bg-primary/5"
                    : "border-border bg-muted/40"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{col.title}</h2>
                    <span className="num rounded-md bg-background px-2 py-0.5 text-xs font-semibold">
                      {items.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{col.hint}</p>
                  {sum > 0 && (
                    <p className="num mt-1 text-xs font-semibold text-success">
                      {money(sum)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((lead) => (
                    <article
                      key={lead.id}
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => setDragId(null)}
                      className="surface cursor-grab p-3 active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold">
                          {lead.client_name}
                        </h3>
                        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                      </div>
                      {lead.request && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {lead.request}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {lead.tariff && (
                          <span className="rounded-md bg-secondary px-1.5 py-0.5">
                            {lead.tariff}
                          </span>
                        )}
                        {!!lead.amount && (
                          <span className="num font-semibold">
                            {money(lead.amount)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{nameOf(lead.manager_id)}</span>
                        <span className="flex items-center gap-1.5">
                          {lead.phone && <Phone className="size-3" />}
                          {lead.telegram && <Send className="size-3" />}
                          {lead.lead_date}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewLeadDialog() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: employees = [] } = useEmployees();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    client_name: "",
    phone: "",
    telegram: "",
    request: "",
    tariff: "",
    amount: "",
    status: "new" as LeadStatus,
    manager_id: "",
  });

  const managerId = form.manager_id || me?.employee?.id || "";

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("leads").insert({
        client_name: form.client_name,
        phone: form.phone || null,
        telegram: form.telegram || null,
        request: form.request || null,
        tariff: form.tariff || null,
        amount: form.amount ? Number(form.amount) : null,
        net_amount: form.amount ? Number(form.amount) : null,
        status: form.status,
        lead_date: new Date().toISOString().slice(0, 10),
        manager_id: managerId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Заявка добавлена");
      setOpen(false);
      setForm({
        client_name: "",
        phone: "",
        telegram: "",
        request: "",
        tariff: "",
        amount: "",
        status: "new",
        manager_id: "",
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> Новая заявка
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Имя клиента</Label>
            <Input
              value={form.client_name}
              onChange={(e) =>
                setForm({ ...form, client_name: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telegram</Label>
              <Input
                value={form.telegram}
                onChange={(e) => setForm({ ...form, telegram: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Запрос</Label>
            <Textarea
              value={form.request}
              onChange={(e) => setForm({ ...form, request: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Тариф</Label>
              <Input
                value={form.tariff}
                onChange={(e) => setForm({ ...form, tariff: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Сумма, ₽</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Статус</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  setForm({ ...form, status: v as LeadStatus })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {me?.isAdmin && (
              <div className="space-y-1.5">
                <Label>Менеджер</Label>
                <Select
                  value={managerId}
                  onValueChange={(v) => setForm({ ...form, manager_id: v })}
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
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.client_name || create.isPending}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { statusMeta };
