import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { db as supabase, getLocalSessionToken } from "@/lib/db-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Paperclip, Smile, X } from "lucide-react";

type ChatMessage = {
  id: string;
  direction: "out" | "in";
  sender_type: "manager" | "client" | "system";
  body: string | null;
  attachment_file_id: string | null;
  attachment_file_name: string | null;
  status: "pending" | "sent" | "delivered" | "failed";
  created_at: string;
};

const EMOJI = [
  "😀",
  "😉",
  "🙏",
  "👍",
  "👌",
  "🎉",
  "❤️",
  "😂",
  "🤝",
  "📌",
  "✅",
  "⏳",
  "🔥",
  "😅",
  "🙌",
  "😊",
];

export function LeadChat({
  leadId,
  telegramChatId,
}: {
  leadId: string;
  telegramChatId: number | null;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: messages = [], error: messagesError } = useQuery({
    queryKey: ["messages", leadId],
    refetchInterval: 4000,
    refetchIntervalInBackground: true,
    enabled: !!telegramChatId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ChatMessage[];
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set("token", getLocalSessionToken() ?? "");
      form.set("lead_id", leadId);
      if (text.trim()) form.set("body", text.trim());
      if (file) form.set("file", file);
      const response = await fetch("/api/telegram/send", { method: "POST", body: form });
      const result = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok || result.error)
        throw new Error(result.error || "Не удалось отправить сообщение");
      return result.message;
    },
    onSuccess: () => {
      setText("");
      setFile(null);
      setShowEmoji(false);
      qc.invalidateQueries({ queryKey: ["messages", leadId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const botUsername = import.meta.env["VITE_TELEGRAM_BOT_USERNAME"] as string | undefined;
  const deepLink = botUsername ? `https://t.me/${botUsername}?start=${leadId}` : null;

  if (!telegramChatId) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Переписка в Telegram</p>
        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <p>Клиент ещё не подключил Telegram-бота.</p>
          {deepLink ? (
            <>
              <div className="mt-2 flex items-center gap-2">
                <Input readOnly value={deepLink} className="text-xs" />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(deepLink);
                    toast.success("Ссылка скопирована");
                  }}
                >
                  Копировать
                </Button>
              </div>
              <p className="mt-2 text-xs">
                Отправьте эту ссылку клиенту. После нажатия «Start» в боте переписка появится здесь.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs">Имя бота не настроено (VITE_TELEGRAM_BOT_USERNAME).</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Переписка в Telegram</p>
      {messagesError && (
        <p className="text-xs text-destructive">
          Не удалось загрузить переписку: {messagesError.message}
        </p>
      )}
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">Сообщений пока нет</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.direction === "out"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start bg-secondary"
            }`}
          >
            {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
            {m.attachment_file_name && (
              <a
                className="mt-1 flex items-center gap-1 text-xs underline underline-offset-2"
                href={`/api/telegram/file?token=${encodeURIComponent(getLocalSessionToken() ?? "")}&message_id=${m.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Paperclip className="size-3 shrink-0" />
                {m.attachment_file_name}
              </a>
            )}
            <p className="mt-1 text-[10px] opacity-70">
              {new Date(m.created_at).toLocaleString("ru-RU")}
              {m.status === "failed" && " · не доставлено"}
              {m.status === "pending" && " · отправка…"}
            </p>
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={() => fileInputRef.current?.click()}
          title="Прикрепить файл"
        >
          <Paperclip className="size-4" />
        </Button>
        <div className="relative flex-1">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Сообщение клиенту…"
            className="min-h-[40px] resize-none pr-9"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if ((text.trim() || file) && !send.isPending) send.mutate();
              }
            }}
          />
          <button
            type="button"
            className="absolute bottom-2 right-2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowEmoji((s) => !s)}
            title="Эмодзи"
          >
            <Smile className="size-4" />
          </button>
          {showEmoji && (
            <div className="absolute bottom-10 right-0 z-10 grid grid-cols-8 gap-1 rounded-lg border bg-popover p-2 shadow-md">
              {EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="text-lg hover:scale-110"
                  onClick={() => setText((t) => t + emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button onClick={() => send.mutate()} disabled={send.isPending || (!text.trim() && !file)}>
          Отправить
        </Button>
      </div>
      {file && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3" /> {file.name}
          <button type="button" onClick={() => setFile(null)} title="Убрать файл">
            <X className="size-3" />
          </button>
        </p>
      )}
    </div>
  );
}
