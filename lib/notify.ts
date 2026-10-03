/**
 * Outbound notifications — Telegram via the plain HTTP Bot API (no deps).
 *
 * Credentials resolve per-user from userSettings/{uid} first, then the
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID env fallback (shared channel).
 * Tokens are never logged or returned to clients.
 */
import { storeList } from "@/lib/store";
import type { UserSettings } from "@/lib/scanner/types";

interface TelegramCreds {
  token: string;
  chatId: string;
}

/** Resolve the sender's Telegram creds: their user settings, else env. */
export async function telegramCredsFor(uid: string): Promise<TelegramCreds | null> {
  const doc = (await storeList<UserSettings>("user-settings.json")).find(
    (d) => d.uid === uid || d.id === uid,
  );
  const token = doc?.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = doc?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

/**
 * Send a Telegram message. Returns the error string on failure so callers
 * can surface it — notification failures never throw into the caller's flow.
 */
export async function sendTelegram(
  uid: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const creds = await telegramCredsFor(uid);
  if (!creds) return { ok: false, error: "Telegram not configured" };
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${creds.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: creds.chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const body = await res.text();
      let msg = `Telegram ${res.status}`;
      try {
        msg = (JSON.parse(body) as { description?: string }).description ?? msg;
      } catch {
        /* keep generic */
      }
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}
