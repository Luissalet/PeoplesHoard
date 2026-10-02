// What runs on its own while the app is up: the mail pass (every 30 minutes) and the birthday-gifts sweep (every hour).
// Both only talk to the hub and stay quiet when it is not there. PEOPLE_MAIL_AUTO=0 switches the mail pass off.
// The timers are the family's startBackground (no overlapping passes, a failing pass is logged and the loop goes on).
import { runMailSync, mailSyncEnabled } from "./mailsync.js";
import { giftSweep } from "./gifts.js";
import { getPublicUrl } from "./agenda.js";
import { startBackground as every, envFlag } from "./hoard-commons/server.js";

export const MAIL_INTERVAL_MS = 30 * 60 * 1000;
export const GIFT_INTERVAL_MS = 60 * 60 * 1000;
export const mailAutoEnabled = (env = process.env) => envFlag("PEOPLE_MAIL_AUTO", true, env);

const jobs = [];

export function startBackground({ mailIntervalMs = MAIL_INTERVAL_MS, giftIntervalMs = GIFT_INTERVAL_MS, firstDelayMs = 20000, env = process.env } = {}) {
  stopBackground();
  const started = { mail: false, gifts: true };
  if (mailAutoEnabled(env)) {
    started.mail = true;
    jobs.push(every({ name: "people-mail", intervalMs: mailIntervalMs, firstDelayMs, tick: async () => { if (mailSyncEnabled()) await runMailSync(); } }));
  }
  jobs.push(every({ name: "people-gifts", intervalMs: giftIntervalMs, firstDelayMs: firstDelayMs + 5000, tick: () => giftSweep({ baseUrl: getPublicUrl() }) }));
  return started;
}

export function stopBackground() {
  for (const job of jobs.splice(0)) job.stop();
}
