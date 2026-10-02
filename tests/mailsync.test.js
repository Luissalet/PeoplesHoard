// Last contact from the hub's mail: interest registered from the e-mails in the book, subjects only, nothing claimed.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { db, getSetting, setSetting } from "../server/db.js";
import * as people from "../server/people.js";
import * as aliases from "../server/aliases.js";
import { listInteractions } from "../server/interactions.js";
import * as family from "../server/hoard-link.js";
import { syncMail, runMailSync, contactEmails, interestSpec, mailSyncStatus, KEYS, MAX_ADDRESSES, PAGE_SIZE, contactsChanged, stopRefreshTimer } from "../server/mailsync.js";
import { startBackground, stopBackground, mailAutoEnabled } from "../server/background.js";

let s, hub, marta, pedro, nextId = 0;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
  pedro = people.createPerson({ name: "Pedro Gil" });
  aliases.addAlias(marta.id, { kind: "email", value: "Marta.Lozano@example.test" });
  aliases.addAlias(marta.id, { kind: "whatsapp", value: "Marta WA" });
  aliases.addAlias(pedro.id, { kind: "email", value: "pedro@example.test" });
  stopRefreshTimer();
});
after(async () => {
  stopRefreshTimer();
  stopBackground();
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});
beforeEach(() => {
  family.mailForgetAvailability();
  hub.state.mailStatus = { ready: true, interval_min: 10, fresh_s: 5 };
  stopRefreshTimer();
});

const mail = (from, subject, ts, extra = {}) => {
  const id = ++nextId;
  const message = { id, message_id: `<m${id}@example.test>`, source: "acct", from_addr: from, from_name: "", subject, date_ts: ts, text: "SECRET BODY never stored", ...extra };
  hub.state.mail.push(message);
  return message;
};
const T = (iso) => Math.floor(Date.parse(iso) / 1000);
const mailLines = (id) => listInteractions(id).filter((i) => i.source === "mail");

test("the interest is the e-mail aliases of the people in the book, and only those", () => {
  assert.deepEqual(contactEmails().map((e) => e.email).sort(), ["marta.lozano@example.test", "pedro@example.test"]);
  assert.deepEqual(interestSpec().from_addresses.sort(), ["marta.lozano@example.test", "pedro@example.test"]);
});

test("a pass registers the interest, reads from the watermark and keeps date, channel and subject, never the body", async () => {
  mail("marta.lozano@example.test", "Presupuesto de la reforma", T("2026-09-20T10:00:00Z"));
  mail("PEDRO@example.test", "Re:   Llaves  del piso", T("2026-09-25T18:30:00Z"));
  const out = await syncMail();
  assert.equal(out.status, "ok");
  assert.equal(out.registered, true);
  assert.equal(out.read, 2);
  assert.equal(out.logged, 2);
  assert.deepEqual(hub.state.interests.at(-1).from_addresses.sort(), ["marta.lozano@example.test", "pedro@example.test"]);
  const [m] = mailLines(marta.id);
  assert.equal(m.channel, "email");
  assert.equal(m.summary, "Correo: Presupuesto de la reforma");
  assert.equal(m.at, "2026-09-20T10:00:00.000Z");
  assert.equal(mailLines(pedro.id)[0].summary, "Correo: Re: Llaves del piso");
  assert.equal(people.getPerson(marta.id).last_contact_at, "2026-09-20T10:00:00.000Z");
  assert.equal(people.getPerson(pedro.id).last_contact_at, "2026-09-25T18:30:00.000Z");
  const dump = JSON.stringify(db().prepare("SELECT * FROM interactions").all()) + JSON.stringify(db().prepare("SELECT * FROM settings").all());
  assert.ok(!dump.includes("SECRET BODY"), "the body is never read into the book");
  assert.ok(hub.state.mailRequests.every((r) => r.includes("fields=headers")), "the list and category headers are asked for, so bulk mail can be told apart");
  assert.equal(hub.state.claims.length, 0, "the mail is not claimed: it is not this app's");
  assert.equal(getSetting(KEYS.since), hub.state.mail.at(-1).id);
});

test("a second pass reads only what is new and registers nothing again", async () => {
  const interests = hub.state.interests.length;
  mail("marta.lozano@example.test", "Otro asunto", T("2026-09-28T08:00:00Z"));
  const out = await syncMail();
  assert.equal(out.registered, false);
  assert.equal(out.read, 1);
  assert.equal(out.logged, 1);
  assert.equal(hub.state.interests.length, interests);
  assert.equal(people.getPerson(marta.id).last_contact_at, "2026-09-28T08:00:00.000Z");
  const quiet = await syncMail();
  assert.equal(quiet.read, 0);
});

test("a person gets one line per day however many mails arrive, and re-reading changes nothing", async () => {
  const day = "2026-10-01";
  mail("pedro@example.test", "Primero", T(`${day}T12:00:00Z`));
  mail("pedro@example.test", "Segundo", T(`${day}T12:30:00Z`));
  const before = mailLines(pedro.id).length;
  const out = await syncMail();
  assert.equal(out.read, 2);
  assert.equal(out.logged, 1);
  assert.equal(mailLines(pedro.id).length, before + 1);
  setSetting(KEYS.since, 0);
  const again = await syncMail();
  assert.equal(again.logged, 0);
  assert.equal(mailLines(pedro.id).length, before + 1);
});

test("bulk mail from a person's address (a mailing list, Gmail promotions) is not a contact", async () => {
  mail("pedro@example.test", "Oferta de la semana", T("2026-10-02T10:00:00Z"), { headers: { list_unsubscribe: "<mailto:baja@example.test>" } });
  mail("marta.lozano@example.test", "Novedades", T("2026-10-02T10:05:00Z"), { headers: { gmail_category: "promotions" } });
  const before = db().prepare("SELECT COUNT(*) AS n FROM interactions").get().n;
  const out = await syncMail();
  assert.equal(out.logged, 0);
  assert.equal(out.bulk, 2);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM interactions").get().n, before);
});

test("my own mail, an archived person and an address nobody has are skipped", async () => {
  const archived = people.createPerson({ name: "Archivada Gómez", archived: true });
  aliases.addAlias(archived.id, { kind: "email", value: "archivada@example.test" });
  mail("pedro@example.test", "Enviado por mí", T("2026-10-02T09:00:00Z"), { reasons: ["own mail"] });
  mail("archivada@example.test", "De alguien archivado", T("2026-10-02T09:10:00Z"));
  mail("desconocido@example.test", "De nadie", T("2026-10-02T09:20:00Z"));
  const before = db().prepare("SELECT COUNT(*) AS n FROM interactions").get().n;
  const out = await syncMail();
  assert.equal(out.logged, 0);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM interactions").get().n, before);
  assert.ok(!hub.state.interests.at(-1).from_addresses.includes("archivada@example.test"));
});

test("a new e-mail address changes the interest and the stored mail is read again from the start", async () => {
  const ana = people.createPerson({ name: "Ana Torres" });
  aliases.addAlias(ana.id, { kind: "email", value: "ana@example.test" });
  stopRefreshTimer();
  mail("ana@example.test", "Hola Ana", T("2026-09-10T09:00:00Z"));   // stored long ago, matched only now
  setSetting(KEYS.since, 99999);                                      // the watermark has moved well past it
  const before = hub.state.interests.length;
  const out = await syncMail();
  assert.equal(out.registered, true);
  assert.equal(hub.state.interests.length, before + 1);
  assert.ok(hub.state.interests.at(-1).from_addresses.includes("ana@example.test"));
  assert.equal(mailLines(ana.id).length, 1, "mail that was already stored finds its new owner");
});

test("without the hub's mail gateway nothing happens", async () => {
  hub.state.mailStatus = { ready: false };
  mail("pedro@example.test", "No debería leerse", T("2026-10-03T09:00:00Z"));
  const before = hub.state.mailRequests.length;
  const out = await syncMail();
  assert.equal(out.status, "mail_unavailable");
  assert.equal(hub.state.mailRequests.length, before);
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  family.mailForgetAvailability();
  try { assert.equal((await syncMail()).status, "mail_unavailable"); } finally { process.env.HOARD_HUB_URL = saved; }
});

test("the setting turns the pass off, force runs it anyway, and the tool, the route and the status agree", async () => {
  const off = await s.call("POST", "/api/settings", { mail_sync: false });
  assert.equal(off.body.mail_sync, false);
  assert.equal((await syncMail()).status, "off");
  assert.equal((await runMailSync()).status, "off");
  assert.equal(mailSyncStatus().enabled, false);
  const forced = await s.agent("contacts_sync_mail", { force: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(forced.body.status, "ok");
  assert.equal(forced.body.read, 1, "the mail that arrived while it was off is read now");
  await s.call("POST", "/api/settings", { mail_sync: true });
  const viaRest = await s.call("POST", "/api/mail-sync", {});
  assert.equal(viaRest.body.result.status, "ok");
  assert.equal(viaRest.body.sync.enabled, true);
  assert.equal(viaRest.body.sync.last_status, "ok");
  assert.equal((await s.call("POST", "/api/settings", { mail_sync: "yes" })).status, 400);
});

test("changing an e-mail alias re-registers the interest soon, and the background loop honours PEOPLE_MAIL_AUTO", async () => {
  const p = people.createPerson({ name: "Cambio Reciente" });
  const before = hub.state.interests.length;
  contactsChanged({ delayMs: 10 });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(hub.state.interests.length, before, "nothing changed in the set yet");
  aliases.addAlias(p.id, { kind: "email", value: "cambio@example.test" });
  stopRefreshTimer();
  contactsChanged({ delayMs: 10 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hub.state.interests.length, before + 1);
  assert.ok(hub.state.interests.at(-1).from_addresses.includes("cambio@example.test"));
  assert.equal(mailAutoEnabled({ PEOPLE_MAIL_AUTO: "0" }), false);
  assert.equal(mailAutoEnabled({}), true);
  assert.deepEqual(startBackground({ env: { PEOPLE_MAIL_AUTO: "0" }, firstDelayMs: 1e6, mailIntervalMs: 1e6, giftIntervalMs: 1e6 }), { mail: false, gifts: true });
  assert.deepEqual(startBackground({ firstDelayMs: 1e6, mailIntervalMs: 1e6, giftIntervalMs: 1e6 }), { mail: true, gifts: true });
  stopBackground();
});

test("at most a few hundred addresses are registered, and paging reads everything", async () => {
  assert.equal(MAX_ADDRESSES, 300);
  for (let i = 0; i < 305; i++) {
    const p = people.createPerson({ name: `Contacto ${i}` });
    aliases.addAlias(p.id, { kind: "email", value: `c${i}@example.test` });
  }
  stopRefreshTimer();
  assert.equal(contactEmails().length, 300);
  assert.equal(contactEmails({ limit: 3 }).length, 3);
  hub.state.mail.length = 0;
  for (let i = 0; i < PAGE_SIZE + 20; i++) mail(`c${i}@example.test`, `Asunto ${i}`, T("2026-08-01T10:00:00Z") + i * 86400);
  setSetting(KEYS.since, 0);
  const out = await syncMail();
  assert.equal(out.registered, true);
  assert.equal(hub.state.interests.at(-1).from_addresses.length, 300);
  assert.equal(out.read, PAGE_SIZE + 20);
  assert.equal(out.logged, PAGE_SIZE + 20);
});
