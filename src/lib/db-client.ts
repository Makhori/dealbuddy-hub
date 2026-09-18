import {
  getSessionServer,
  loginServer,
  logoutServer,
  queryServer,
  saveInvoiceServer,
  sendInvoiceServer,
  syncGoogleSheetsServer,
} from "./db.functions";

const STORAGE_KEY = "pulse-crm:sqlite-session";
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type User = { id: string; email: string };
type StoredSession = { access_token: string; expires_at: string; user: User };
type DbError = Error | null;

const listeners = new Set<(event: AuthEvent, session: StoredSession | null) => void>();

function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeSession(value: StoredSession | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(STORAGE_KEY);
}

function currentToken() {
  return readSession()?.access_token ?? null;
}

class QueryBuilder implements PromiseLike<{ data: any; error: DbError }> {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private columns = "*";
  private payload: Record<string, unknown> | Record<string, unknown>[] | undefined;
  private filters: { op: "eq" | "neq" | "gte" | "lt"; column: string; value: unknown }[] = [];
  private orderBy: { column: string; ascending: boolean; nullsFirst?: boolean } | undefined;
  private limitCount: number | undefined;
  private singleMode: "single" | "maybe" | undefined;
  private conflict: string | undefined;

  constructor(private readonly table: string) {}

  select(columns = "*") {
    this.action = "select";
    this.columns = columns;
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  upsert(
    payload: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string },
  ) {
    this.action = "upsert";
    this.payload = payload;
    this.conflict = options?.onConflict;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ op: "gte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orderBy = {
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  async execute() {
    try {
      const data = await queryServer({
        data: {
          token: currentToken(),
          table: this.table as any,
          action: this.action,
          columns: this.columns,
          payload: this.payload,
          filters: this.filters,
          order: this.orderBy,
          limit: this.limitCount,
          single: this.singleMode,
          onConflict: this.conflict,
        },
      });
      return { data, error: null };
    } catch (cause) {
      return { data: null, error: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }

  then<TResult1 = { data: any; error: DbError }, TResult2 = never>(
    onfulfilled?:
      ((value: { data: any; error: DbError }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export const db = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  auth: {
    async signInWithPassword(credentials: { email: string; password: string }) {
      try {
        const result = await loginServer({ data: credentials });
        const value: StoredSession = {
          access_token: result.token,
          expires_at: result.expiresAt,
          user: result.user,
        };
        writeSession(value);
        listeners.forEach((listener) => listener("SIGNED_IN", value));
        return { data: { user: result.user, session: value }, error: null };
      } catch (cause) {
        return {
          data: { user: null, session: null },
          error: cause instanceof Error ? cause : new Error(String(cause)),
        };
      }
    },
    async getUser() {
      const local = readSession();
      if (!local) return { data: { user: null }, error: null };
      try {
        const result = await getSessionServer({ data: { token: local.access_token } });
        if (!result) {
          writeSession(null);
          return { data: { user: null }, error: new Error("Сессия истекла") };
        }
        return { data: { user: result.user }, error: null };
      } catch (cause) {
        return {
          data: { user: null },
          error: cause instanceof Error ? cause : new Error(String(cause)),
        };
      }
    },
    async getSession() {
      return { data: { session: readSession() }, error: null };
    },
    async signOut() {
      const value = readSession();
      try {
        await logoutServer({ data: { token: value?.access_token ?? null } });
      } finally {
        writeSession(null);
        listeners.forEach((listener) => listener("SIGNED_OUT", null));
      }
      return { error: null };
    },
    onAuthStateChange(callback: (event: AuthEvent, session: StoredSession | null) => void) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
  },
};

export function getLocalSessionToken() {
  return currentToken();
}

export async function syncGoogleSheets() {
  return syncGoogleSheetsServer({ data: { token: currentToken() } });
}

export async function saveInvoice(input: {
  id: string | null;
  leadId: string;
  description: string;
  amount: number;
  issueDate: string;
  dueDate: string | null;
}) {
  return saveInvoiceServer({ data: { token: currentToken(), ...input } });
}

export async function sendInvoice(invoiceId: string) {
  return sendInvoiceServer({ data: { token: currentToken(), invoiceId } });
}
