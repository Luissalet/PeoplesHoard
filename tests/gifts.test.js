// Gift ideas: save, list, watch through Tantalus, and the digest line some days before a birthday.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootServer } from "./helpers.js";
import { startFakeHub } from "./fake-hub.js";
import { today, addDays } from "../server/dates.js";
import * as people from "../server/people.js";
import * as gifts from "../server/gifts.js";
import { getSetting } from "../server/db.js";

let s, hub, marta, pedro;
before(async () => {
  hub = await startFakeHub();
  process.env.HOARD_HUB_URL = hub.url;
  s = await bootServer();
  marta = people.createPerson({ name: "Marta Lozano" });
  pedro = people.createPerson({ name: "Pedro Gil" });
});
after(async () => {
  await s.stop();
  await hub.stop();
  delete process.env.HOARD_HUB_URL;
});
beforeEach(() => { hub.state.calls.length = 0; });

const birthdayIn = (days) => `1990-${addDays(today(), days).slice(5)}`;
const digestItems = () => hub.state.emitted.filter((e) => e.type === "digest.item" && e.data.kind === "gift");

test("ideas are saved per person, once each, with a page and a budget", async () => {
  const first = await s.agent("gift_idea_add", { person: "Marta", idea: "Libro de cocina japonesa", url: "https://shop.example.test/libro", budget: 25 });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.created, true);
  assert.equal(first.body.gift.person_id, marta.id);
  assert.equal(first.body.gift.budget, 25);
  assert.equal(first.body.gift.status, "idea");
  assert.equal(first.body.gift.watched, false);
  assert.equal(first.body.gift.ref, `hoard://people/gift/${first.body.gift.id}`);
  const again = await s.agent("gift_idea_add", { person: "Marta Lozano", idea: "libro de cocina japonesa" });
  assert.equal(again.body.created, false);
  assert.equal(again.body.gift.id, first.body.gift.id);
  await s.agent("gift_idea_add", { person: "Pedro", idea: "Auriculares" });
  const mine = await s.agent("gift_ideas", { person: "Marta" });
  assert.deepEqual(mine.body.gifts.map((g) => g.idea), ["Libro de cocina japonesa"]);
  const everyone = await s.agent("gift_ideas", {});
  assert.equal(everyone.body.gifts.length, 2);
  assert.equal((await s.agent("gift_idea_add", { person: "Nadie Inventado", idea: "x" })).status, 400);
  assert.equal((await s.agent("gift_idea_add", { person: "Marta", idea: "x", url: "javascript:alert(1)" })).status, 400);
});

test("REST: list, add, change status, delete; bought ideas leave the default list", async () => {
  const added = await s.call("POST", `/api/people/${pedro.id}/gifts`, { idea: "Funda para el móvil", budget: 12.5 });
  assert.equal(added.status, 201);
  const id = added.body.gift.id;
  assert.equal((await s.call("GET", `/api/gifts?person=${pedro.id}`)).body.gifts.length, 2);
  const bought = await s.call("PATCH", `/api/gifts/${id}`, { status: "bought" });
  assert.equal(bought.body.status, "bought");
  assert.equal((await s.call("GET", `/api/gifts?person=${pedro.id}`)).body.gifts.length, 1);
  assert.equal((await s.call("GET", `/api/gifts?person=${pedro.id}&status=all`)).body.gifts.length, 2);
  assert.equal((await s.call("PATCH", `/api/gifts/${id}`, { status: "mal" })).status, 400);
  assert.equal((await s.call("DELETE", `/api/gifts/${id}`)).body.ok, true);
  assert.equal((await s.call("PATCH", "/api/gifts/nope", { idea: "x" })).status, 404);
  assert.equal((await s.call("POST", `/api/people/${pedro.id}/gifts`, { idea: "" })).status, 400);
});

test("watching an idea asks Tantalus with its text, page and budget, and keeps the watcher id", async () => {
  hub.state.tools["tantalus.watcher_add"] = () => ({ ok: true, existing: false, watcher_id: "w-17", name: "Libro" });
  const [libro] = gifts.listGifts({ person_id: marta.id });
  const out = await s.agent("gift_watch", { idea_id: libro.id });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.ok, true);
  assert.equal(out.body.watcher_id, "w-17");
  assert.equal(out.body.gift.watched, true);
  assert.deepEqual(hub.state.calls, [{ app: "tantalus", tool: "watcher_add", arguments: {
    name: "Libro de cocina japonesa", url: "https://shop.example.test/libro", budget: 25, source_ref: `hoard://people/gift/${libro.id}` } }]);
  const again = await s.agent("gift_watch", { idea_id: libro.id });
  assert.equal(again.body.existing, true);
  assert.equal(again.body.watcher_id, "w-17");
  assert.equal(hub.state.calls.length, 1, "asking twice does not ask Tantalus twice");
  assert.equal(gifts.getGift(libro.id).watcher_id, "w-17");
  assert.equal((await s.call("POST", "/api/gifts/nope/watch", {})).status, 404);
  assert.equal((await s.agent("gift_watch", { idea_id: "nope" })).status, 404);
});

test("an idea without a page or a budget is watched by its words alone", async () => {
  hub.state.tools["tantalus.watcher_add"] = (args) => ({ ok: true, watcher_id: "w-18", seen: args });
  const { gift } = gifts.addGift(pedro.id, { idea: "Cartera de cuero" });
  const out = await gifts.watchGift(gift.id);
  assert.equal(out.ok, true);
  assert.deepEqual(hub.state.calls.at(-1).arguments, { name: "Cartera de cuero", source_ref: `hoard://people/gift/${gift.id}` });
});

test("Tantalus being away or older is reported, nothing is stored", async () => {
  const { gift } = gifts.addGift(pedro.id, { idea: "Mochila" });
  hub.state.tools["tantalus.watcher_add"] = () => ({ __error: { status: 404, error: "Unknown tool: watcher_add" } });
  assert.equal((await gifts.watchGift(gift.id)).status, "tool_missing");
  hub.state.tools["tantalus.watcher_add"] = () => ({ __error: { status: 404, error: "app tantalus is not installed" } });
  assert.equal((await gifts.watchGift(gift.id)).status, "tantalus_unavailable");
  hub.state.tools["tantalus.watcher_add"] = () => ({ __error: { status: 500, error: "boom" } });
  assert.equal((await gifts.watchGift(gift.id)).status, "tantalus_error");
  hub.state.tools["tantalus.watcher_add"] = () => ({ ok: true });
  assert.equal((await gifts.watchGift(gift.id)).status, "tantalus_error");
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try { assert.equal((await gifts.watchGift(gift.id)).status, "hub_down"); } finally { process.env.HOARD_HUB_URL = saved; }
  assert.equal(gifts.getGift(gift.id).watcher_id, null);
});

test("21 days before a birthday the saved ideas go to the digest, once per birthday", async () => {
  assert.equal(gifts.giftDaysBefore(), 21);
  const ana = people.createPerson({ name: "Ana Torres", birthday: birthdayIn(10) });
  const far = people.createPerson({ name: "Lejos Lopez", birthday: birthdayIn(60) });
  const bare = people.createPerson({ name: "Sin Ideas", birthday: birthdayIn(5) });
  gifts.addGift(ana.id, { idea: "Bufanda azul" });
  gifts.addGift(ana.id, { idea: "Entradas de teatro" });
  gifts.addGift(far.id, { idea: "Un reloj" });
  gifts.addGift(bare.id, { idea: "Chocolates" });
  gifts.updateGift(gifts.listGifts({ person_id: bare.id })[0].id, { status: "bought" });
  assert.equal(await gifts.giftSweep({ baseUrl: "http://127.0.0.1:5182" }), 1);
  const [item] = digestItems().filter((e) => e.data.person_id === ana.id);
  assert.equal(item.data.title, "Cumpleaños de Ana Torres en 10 días: ideas guardadas: Bufanda azul; Entradas de teatro");
  assert.equal(item.data.url, `http://127.0.0.1:5182/#/personas/${ana.id}`);
  assert.equal(item.data.watch, "people");
  assert.equal(item.data.kind, "gift");
  assert.equal(digestItems().length, 1, "far birthdays and people with nothing left to give are left out");
  assert.equal(await gifts.giftSweep(), 0, "the same birthday is not announced twice");
  assert.equal(digestItems().length, 1);
  // a longer lead time picks the far one up, and the setting is validated
  assert.equal((await s.call("POST", "/api/settings", { gift_days_before: 90 })).body.gift_days_before, 90);
  assert.equal(await gifts.giftSweep(), 1);
  assert.match(digestItems().at(-1).data.title, /^Cumpleaños de Lejos Lopez en 60 días: ideas guardadas: Un reloj$/);
  assert.equal((await s.call("POST", "/api/settings", { gift_days_before: -1 })).status, 400);
  assert.equal((await s.call("POST", "/api/settings", { gift_days_before: 3.5 })).status, 400);
  await s.call("POST", "/api/settings", { gift_days_before: 21 });
  assert.equal((await s.call("GET", "/api/settings")).body.gift_days_before, 21);
});

test("today and tomorrow read naturally, and a hub that is away does not use up the announcement", async () => {
  assert.equal(gifts.birthdayGiftLine("Pepe", 0, [{ idea: "a" }]), "Cumpleaños de Pepe hoy: ideas guardadas: a");
  assert.equal(gifts.birthdayGiftLine("Pepe", 1, [{ idea: "a" }, { idea: "b" }]), "Cumpleaños de Pepe en 1 día: ideas guardadas: a; b");
  const lola = people.createPerson({ name: "Lola Mendez", birthday: birthdayIn(3) });
  gifts.addGift(lola.id, { idea: "Plantas" });
  const saved = process.env.HOARD_HUB_URL;
  process.env.HOARD_HUB_URL = "http://127.0.0.1:1";
  try { assert.equal(await gifts.giftSweep(), 0); } finally { process.env.HOARD_HUB_URL = saved; }
  assert.equal(await gifts.giftSweep(), 1, "the hub came back: it is sent now");
  assert.ok(Object.keys(getSetting("gift_digest_sent", {})).some((key) => key.startsWith(lola.id)));
});

test("ideas move with a merged person, survive export and import, and go with a deleted person", async () => {
  const a = people.createPerson({ name: "Fusion A" });
  const b = people.createPerson({ name: "Fusion B" });
  gifts.addGift(b.id, { idea: "Termo" });
  people.mergePeople(a.id, b.id);
  assert.deepEqual(gifts.listGifts({ person_id: a.id }).map((g) => g.idea), ["Termo"]);
  const backup = (await s.call("GET", "/api/export")).body;
  assert.ok(backup.gift_ideas.some((g) => g.idea === "Termo"));
  const restored = (await s.call("POST", "/api/import", backup)).body;
  assert.ok(restored.gift_ideas >= 1);
  assert.equal(people.listPeople({ q: "Fusion A", archived: "all" }).length >= 2, true);
  people.deletePerson(a.id);
  assert.equal(gifts.listGifts({ person_id: a.id, status: "all" }).length, 0);
});
