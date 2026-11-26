import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addAlias } from "../server/aliases.js";
import { init, close } from "../server/db.js";
import * as family from "../server/hoard-link.js";
import { listInteractions } from "../server/interactions.js";
import { mailSyncStatus, runMailSync, stopRefreshTimer } from "../server/mailsync.js";
import { createPerson } from "../server/people.js";

test("last contact uses only the gateway, including when the app runs with test data", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "people-mail-unit-"));
  const hub = "https://people-mail.example.test:9999";
  family.configure({ app: "people", dataDir, tokenFile: path.join(dataDir, "mcp-token"), hub, enabled: false });
  family.mailForgetAvailability();
  init(dataDir);
  t.after(() => {
    stopRefreshTimer();
    close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const person = createPerson({ name: "Test Contact" });
  addAlias(person.id, { kind: "email", value: "contact@example.test" });
  stopRefreshTimer();
  const requests = [];
  let ready = false;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const request = new URL(url);
    assert.equal(request.origin, hub);
    requests.push(request.pathname);
    switch (request.pathname) {
      case "/api/mail/status":
        return Response.json({ ready });
      case "/api/mail/interests":
        assert.deepEqual(JSON.parse(options.body).spec, { from_addresses: ["contact@example.test"] });
        return Response.json({ ok: true });
      case "/api/mail/messages":
        assert.equal(request.searchParams.get("fields"), "headers");
        return Response.json({
          ok: true, last_id: 1,
          messages: [{ id: 1, from_addr: "contact@example.test", subject: "Synthetic subject", text: "Synthetic body" }],
        });
      default:
        throw new Error(`Unexpected request: ${request.pathname}`);
    }
  });

  assert.deepEqual(await runMailSync(), { status: "mail_unavailable" });
  assert.equal(mailSyncStatus().last_status, "mail_unavailable");
  assert.deepEqual(listInteractions(person.id), []);
  assert.deepEqual(requests, ["/api/mail/status"]);

  ready = true;
  family.mailForgetAvailability();
  assert.equal((await runMailSync()).logged, 1);
  const interactions = listInteractions(person.id);
  assert.deepEqual(interactions.map((entry) => entry.summary), ["Correo: Synthetic subject"]);
  assert.equal(mailSyncStatus().since_id, 1);
  assert.deepEqual(requests, ["/api/mail/status", "/api/mail/status", "/api/mail/interests", "/api/mail/messages"]);
});
