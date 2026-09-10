export type LeadStatus = "new" | "in_work" | "offer_sent" | "won" | "lost";

export const LEAD_STATUSES: {
  key: LeadStatus;
  title: string;
  hint: string;
  tone: string;
}[] = [
  {
    key: "new",
    title: "Новая заявка",
    hint: "Только что поступила, не обработана",
    tone: "bg-info/12 text-info border-info/30",
  },
  {
    key: "in_work",
    title: "В работе",
    hint: "Менеджер ведёт переговоры",
    tone: "bg-primary/12 text-primary border-primary/30",
  },
  {
    key: "offer_sent",
    title: "КП отправлено",
    hint: "Ждём решения клиента",
    tone: "bg-warning/20 text-warning-foreground border-warning/40",
  },
  {
    key: "won",
    title: "Оплата",
    hint: "Успешная сделка",
    tone: "bg-success/15 text-success border-success/30",
  },
  {
    key: "lost",
    title: "Закрыта / отказ",
    hint: "Сделка не состоялась",
    tone: "bg-destructive/12 text-destructive border-destructive/30",
  },
];

export function statusMeta(status: string) {
  return LEAD_STATUSES.find((s) => s.key === status) ?? LEAD_STATUSES[0];
}

export function money(value: number | null | undefined) {
  const v = Number(value ?? 0);
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(v);
}

export function compact(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(
    Number(value ?? 0),
  );
}

export function monthStart(date: Date = new Date()) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export function monthLabel(period: string) {
  const d = new Date(period + "T00:00:00Z");
  return d.toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function monthRange(period: string) {
  const start = new Date(period + "T00:00:00Z");
  const end = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
  );
  return { from: period, to: end.toISOString().slice(0, 10) };
}

export type PayrollInput = {
  salary: number;
  baseRate: number;
  minCoef: number;
  targetCoef: number;
  planMin: number;
  planTarget: number;
  fact: number;
};

export type Payroll = {
  coef: number;
  coefLabel: string;
  bonus: number;
  payout: number;
  toMin: number;
  toTarget: number;
  progressTarget: number;
};

export function payroll(input: PayrollInput): Payroll {
  const { salary, baseRate, minCoef, targetCoef, planMin, planTarget, fact } =
    input;
  let coef = 1;
  let coefLabel = "базовый ×1";
  if (planTarget > 0 && fact >= planTarget) {
    coef = targetCoef;
    coefLabel = `целевой ×${targetCoef}`;
  } else if (planMin > 0 && fact >= planMin) {
    coef = minCoef;
    coefLabel = `план-минимум ×${minCoef}`;
  }
  const bonus = (fact * baseRate) / 100 * coef;
  return {
    coef,
    coefLabel,
    bonus,
    payout: salary + bonus,
    toMin: Math.max(planMin - fact, 0),
    toTarget: Math.max(planTarget - fact, 0),
    progressTarget: planTarget > 0 ? Math.min((fact / planTarget) * 100, 100) : 0,
  };
}
