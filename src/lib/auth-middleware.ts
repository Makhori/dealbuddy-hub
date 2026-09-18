import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const requireLocalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const token = getRequest().headers.get("x-session-token");
  const { session } = await import("./sqlite.server");
  const localSession = session(token);
  if (!localSession) throw new Error("Сессия истекла. Войдите снова.");
  return next({ context: { localSession, sessionToken: token } });
});
