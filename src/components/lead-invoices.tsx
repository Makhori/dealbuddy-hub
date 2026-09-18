import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { db as supabase, getLocalSessionToken, saveInvoice, sendInvoice } from "@/lib/db-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Send, Pencil, Plus } from "lucide-react";

type Invoice = {
  id: string;
  number: number;
  issue_date: string;
  due_date: string | null;
  description: string;
  amount: number;
  status: "draft" | "sent" | "failed";
  last_error: string | null;
};

const STATUS_LABEL: Record<Invoice["status"], string> = {
  draft: "Черновик",
  sent: "Отправлен",
  failed: "Ошибка отправки",
};

const STATUS_CLASS: Record<Invoice["status"], string> = {
  draft: "bg-secondary text-secondary-foreground",
  sent: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

const emptyForm = {
  id: null as string | null,
  description: "",
  amount: "",
  issueDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
};

export function LeadInvoices({
  leadId,
  telegramChatId,
}: {
  leadId: string;
  telegramChatId: number | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Invoice[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount.replace(",", "."));
      const result = await saveInvoice({
        id: form.id,
        leadId,
        description: form.description,
        amount,
        issueDate: form.issueDate,
        dueDate: form.dueDate || null,
      });
      return result;
    },
    onSuccess: (invoice) => {
      qc.invalidateQueries({ queryKey: ["invoices", leadId] });
      setForm({ ...form, id: invoice.id });
      toast.success(`Счёт № ${invoice.number} сохранён`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: (invoiceId: string) => sendInvoice(invoiceId),
    onSuccess: (invoice) => {
      qc.invalidateQueries({ queryKey: ["invoices", leadId] });
      qc.invalidateQueries({ queryKey: ["messages", leadId] });
      toast.success(`Счёт № ${invoice.number} отправлен клиенту в Telegram`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pdfUrl = (invoiceId: string) =>
    `/api/invoices/pdf?token=${encodeURIComponent(getLocalSessionToken() ?? "")}&invoice_id=${invoiceId}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Счета</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setForm(emptyForm);
            setOpen((o) => !o);
          }}
        >
          <Plus className="size-3.5" /> Новый счёт
        </Button>
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сумма, ₽</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата счёта</Label>
              <Input
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Описание услуги</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Например: Обучение по тарифу «Стандарт»"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Срок оплаты (необязательно)</Label>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.description.trim() || !Number(form.amount)}
            >
              Сформировать PDF
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {invoices.length === 0 && !open && (
          <p className="text-xs text-muted-foreground">Счетов пока нет</p>
        )}
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
          >
            <div>
              <p className="font-medium">
                Счёт № {invoice.number} от{" "}
                {new Date(invoice.issue_date).toLocaleDateString("ru-RU")}
              </p>
              <p className="text-xs text-muted-foreground">
                {invoice.description} · {invoice.amount.toLocaleString("ru-RU")} ₽
              </p>
              {invoice.status === "failed" && invoice.last_error && (
                <p className="text-xs text-destructive">{invoice.last_error}</p>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`rounded-md px-2 py-0.5 text-xs ${STATUS_CLASS[invoice.status]}`}>
                {STATUS_LABEL[invoice.status]}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Изменить"
                onClick={() => {
                  setForm({
                    id: invoice.id,
                    description: invoice.description,
                    amount: String(invoice.amount),
                    issueDate: invoice.issue_date,
                    dueDate: invoice.due_date ?? "",
                  });
                  setOpen(true);
                }}
              >
                <Pencil className="size-4" />
              </Button>
              <a href={pdfUrl(invoice.id)} target="_blank" rel="noreferrer" title="Скачать PDF">
                <Button type="button" size="icon" variant="ghost">
                  <FileText className="size-4" />
                </Button>
              </a>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title={telegramChatId ? "Отправить в Telegram" : "Клиент не подключил Telegram"}
                disabled={!telegramChatId || send.isPending}
                onClick={() => send.mutate(invoice.id)}
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
