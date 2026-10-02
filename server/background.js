// What runs on its own while the app is up: the mail pass (every 30 minutes) and the birthday-gifts sweep (every hour).
// Both only talk to the hub and stay quiet when it is not there. PEOPLE_MAIL_AUTO=0 switches the mail pass off.
import { runMailSync, mailSyncEnabled } from "./mailsync.js";
import { giftSweep } from "./gifts.js";
import { getPublicUrl } from "./agenda.js";

export const MAIL_INTERVAL_MS = 30 * 60 * 1000;
export const GIFT_INTERVAL_MS = 60 * 60 * 1000;
export const mailAutoEnabled = (env = process.env) => !["0", "false", "no", "off"].includes(String(env.PEOPLE_MAIL_AUTO ?? "1").trim().toLowerCase());

const timers = [];

export function startBackground({ mailIntervalMs = MAIL_INTERVAL_MS, giftIntervalMs = GIFT_INTERVAL_MS, firstDelayMs = 20000, env = process.env } = {}) {
  stopBackground();
  const started = { mail: false, gifts: true };
  const mailLoop = async () => { try { if (mailSyncEnabled()) await runMailSync(); } catch { /* next time */ } };
  const giftLoop = async () => { try { await giftSweep({ baseUrl: getPublicUrl() }); } catch { /* next time */ } };
  if (mailAutoEnabled(env)) {
    started.mail = true;
    timers.push(setInterval(mailLoop, mailIntervalMs), setTimeout(mailLoop, firstDelayMs));
  }
  timers.push(setInterval(giftLoop, giftIntervalMs), setTimeout(giftLoop, firstDelayMs + 5000));
  for (const t of timers) t.unref();
  return started;
}

export function stopBackground() {
  for (const t of timers.splice(0)) { clearInterval(t); clearTimeout(t); }
}
