import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export type SortState = { key: string; dir: "asc" | "desc" };

function compare(a: unknown, b: unknown) {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "ru");
}

export function useSort<T>(
  rows: T[],
  initial: SortState,
  accessor: (row: T, key: string) => unknown,
) {
  const [sort, setSort] = useState<SortState>(initial);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const r = compare(accessor(a, sort.key), accessor(b, sort.key));
      return sort.dir === "asc" ? r : -r;
    });
    return copy;
  }, [rows, sort, accessor]);

  const toggle = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  return { sorted, sort, toggle };
}

export function SortHead({
  label,
  sortKey,
  sort,
  toggle,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  toggle: (key: string) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => toggle(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground ${
          active ? "font-semibold text-foreground" : ""
        }`}
        title="Сортировать"
      >
        {label}
        <Icon className={`size-3.5 ${active ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}
