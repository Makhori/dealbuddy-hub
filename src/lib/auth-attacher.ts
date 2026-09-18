import { createMiddleware } from "@tanstack/react-start";
import { getLocalSessionToken } from "./db-client";

export const attachLocalAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = getLocalSessionToken();
  return next({ headers: token ? { "X-Session-Token": token } : {} });
});
