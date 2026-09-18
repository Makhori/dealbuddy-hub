import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const env = readEnv(resolve(root, ".env.local"));
const token = env.TELEGRAM_BOT_TOKEN;
const secret = env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.argv[2];

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN не задан в .env.local");
  process.exit(1);
}
if (!baseUrl) {
  console.error("Использование: node scripts/set-telegram-webhook.mjs https://<туннель>");
  process.exit(1);
}

const webhookUrl = new URL("/api/telegram/webhook", baseUrl).toString();
const params = new URLSearchParams({ url: webhookUrl });
if (secret) params.set("secret_token", secret);

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook?${params}`);
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) => r.json());
console.log(JSON.stringify(info, null, 2));

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^([^#=]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, "")]),
  );
}
