// REST routes for the UI. Every body is zod-validated in the domain modules;
// errors bubble to the shared error handler in app.js as { error }.
import { z } from "zod";
import * as people from "./people.js";
import * as aliases from "./aliases.js";
import * as facts from "./facts.js";
import * as interactions from "./interactions.js";
import * as reminders from "./reminders.js";
import { upcomingReport } from "./upcoming.js";
import { dataDir } from "./db.js";

const notFound = (res) => res.status(404).json({ error: "No existe." });
const exportSchema = z.object({
  people: z.array(z.record(z.string(), z.any())),
  aliases: z.array(z.record(z.string(), z.any())),
  facts: z.array(z.record(z.string(), z.any())),
  interactions: z.array(z.record(z.string(), z.any())),
  reminders: z.array(z.record(z.string(), z.any())),
});

export function installRoutes(app, { version, dataDirConfigured }) {
  app.get("/api/health", (req, res) => {
    res.json({ service: "peoples-hoard", version, dataDirConfigured });
  });

  app.get("/api/state", (req, res) => {
    res.json({
      version,
      dataDir: dataDir(),
      circles: people.circleCounts(),
    });
  });

  // ---------- People ----------
  app.get("/api/people", (req, res) => {
    res.json(people.listPeople({ q: req.query.q || "", circle: req.query.circle || "", archived: req.query.archived || "false" }));
  });
  app.get("/api/people/:id", (req, res) => {
    const out = people.getPersonFull(req.params.id);
    return out ? res.json(out) : notFound(res);
  });
  app.post("/api/people", (req, res) => res.status(201).json(people.createPerson(req.body || {})));
  app.patch("/api/people/:id", (req, res) => {
    const out = people.updatePerson(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/people/:id", (req, res) => res.json({ ok: people.deletePerson(req.params.id) }));
  app.post("/api/people/merge", (req, res) => {
    const { keep_id, drop_id } = req.body || {};
    if (!keep_id || !drop_id) return res.status(400).json({ error: "Indica keep_id y drop_id." });
    res.json(people.mergePeople(keep_id, drop_id));
  });

  // ---------- Aliases ----------
  app.post("/api/people/:id/aliases", (req, res) => res.status(201).json(aliases.addAlias(req.params.id, req.body || {})));
  app.patch("/api/aliases/:id", (req, res) => {
    const out = aliases.updateAlias(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/aliases/:id", (req, res) => res.json({ ok: aliases.deleteAlias(req.params.id) }));

  // ---------- Facts ----------
  app.post("/api/people/:id/facts", (req, res) => res.status(201).json(facts.addFact(req.params.id, req.body || {})));
  app.patch("/api/facts/:id", (req, res) => {
    const out = facts.updateFact(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/facts/:id", (req, res) => res.json({ ok: facts.deleteFact(req.params.id) }));

  // ---------- Interactions ----------
  app.post("/api/people/:id/interactions", (req, res) =>
    res.status(201).json(interactions.createInteraction(req.params.id, { ...req.body, source: "manual" })));
  app.patch("/api/interactions/:id", (req, res) => {
    const out = interactions.updateInteraction(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/interactions/:id", (req, res) => res.json({ ok: interactions.deleteInteraction(req.params.id) }));

  // ---------- Reminders ----------
  app.post("/api/people/:id/reminders", (req, res) =>
    res.status(201).json(reminders.createReminder({ ...req.body, person_id: req.params.id })));
  app.post("/api/reminders", (req, res) => res.status(201).json(reminders.createReminder(req.body || {})));
  app.patch("/api/reminders/:id", (req, res) => {
    const out = reminders.updateReminder(req.params.id, req.body || {});
    return out ? res.json(out) : notFound(res);
  });
  app.delete("/api/reminders/:id", (req, res) => res.json({ ok: reminders.deleteReminder(req.params.id) }));

  // ---------- Discovery / agenda ----------
  app.get("/api/resolve", (req, res) => {
    const name = req.query.name || "";
    if (!name.trim()) return res.status(400).json({ error: "Falta el parámetro name." });
    const { person, candidates } = people.resolvePersonRef(name);
    if (person) return res.json({ person, candidates: [] });
    res.json({ person: null, candidates: candidates.length ? candidates : people.findPeople(name, { limit: 8 }) });
  });
  app.get("/api/upcoming", (req, res) => {
    res.json(upcomingReport({ days: req.query.days ? Number(req.query.days) : 30 }));
  });
  app.get("/api/circles", (req, res) => res.json(people.circleCounts()));

  // ---------- Backup / restore ----------
  app.get("/api/export", (req, res) => {
    const all = people.listPeople({ archived: "all" });
    const ids = all.map((p) => p.id);
    res.setHeader("Content-Disposition", `attachment; filename="peoples-hoard-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({
      version,
      exported_at: new Date().toISOString(),
      people: all,
      aliases: ids.flatMap((id) => aliases.listAliases(id)),
      facts: ids.flatMap((id) => facts.listFacts(id)),
      interactions: ids.flatMap((id) => interactions.listInteractions(id)),
      reminders: reminders.listReminders({}),
    });
  });

  app.post("/api/import", (req, res) => {
    const data = exportSchema.parse(req.body || {});
    let importedPeople = 0;
    let importedAliases = 0;
    let importedFacts = 0;
    let importedInteractions = 0;
    let importedReminders = 0;
    const idMap = new Map();
    for (const p of data.people) {
      const created = people.createPerson({
        name: p.name,
        nickname: p.nickname,
        circles: p.circles,
        birthday: p.birthday,
        location: p.location,
        how_met: p.how_met,
        summary: p.summary,
        notes: p.notes,
        contact_every_days: p.contact_every_days,
        archived: !!p.archived,
      });
      idMap.set(p.id, created.id);
      importedPeople++;
    }
    for (const a of data.aliases) {
      const personId = idMap.get(a.person_id);
      if (!personId) continue;
      try {
        aliases.addAlias(personId, { kind: a.kind, value: a.value });
        importedAliases++;
      } catch {
        // duplicate handle — skip rather than fail the whole import
      }
    }
    for (const f of data.facts) {
      const personId = idMap.get(f.person_id);
      if (!personId) continue;
      facts.addFact(personId, { key: f.key, value: f.value });
      importedFacts++;
    }
    for (const i of data.interactions) {
      const personId = idMap.get(i.person_id);
      if (!personId) continue;
      interactions.createInteraction(personId, { at: i.at, channel: i.channel, summary: i.summary, source: "manual" });
      importedInteractions++;
    }
    for (const r of data.reminders) {
      reminders.createReminder({ person_id: r.person_id ? idMap.get(r.person_id) || null : null, due: r.due, text: r.text, kind: r.kind });
      importedReminders++;
    }
    res.json({ people: importedPeople, aliases: importedAliases, facts: importedFacts, interactions: importedInteractions, reminders: importedReminders });
  });
}
