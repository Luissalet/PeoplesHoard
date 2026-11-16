# Native API and shared assistant

The native API and MCP tool catalog are documented in `README.md`. The stdio bridge exposes 46 tools and proxies requests to the running app.

The shared assistant uses `/api/copilot/info`, `/api/copilot/panel.js`, `/api/copilot/launcher.js` and `/api/copilot/proxy`. Identity and credentials remain on the server; conversations, drafts and model requests live in Faustus, using the global LLM configured on Sparks.

Context contains real people, commitments and gifts from the native API together with complete unsaved form fields. Creation and missing objects do not invent references. Turn completion refreshes the current page without resetting typed drafts. Partial person edits preserve other fields changed by an agent. Summary and notes autosaves only acknowledge the text actually sent after a successful save; later edits and drafts after a failed response remain available.

## Talos import

`POST /api/commitments/import-talos` (tool `commitments_import_talos`): body `{ commitments | items: [...], meeting?: { title, at, session_id } }` with the `talos.commitment/1` items from Talos's `scribe_requirements` (`format: commitments`). Response: `{ status, imported, queued, duplicates, commitments, rejected: [{ item_id, code, reason }], pending_review }`. Only `kind: commitment` with `firm: true` is accepted; rejection codes are `invalid`, `proposal`, `not_commitment`, `not_firm`, `no_text`, `no_source_ref`. Deduplication key: `talos:<source.ref>`. 400 when neither `commitments` nor `items` is a non-empty array.

## Contexts

One living card per person or per group, with the things that must not be forgotten (gift ideas and wishes, plans with a day, pending things, tastes and places).

| Route | What it does |
| --- | --- |
| `GET /api/contexts?q=&kind=&limit=` | Contexts with how many items are open in each and their members. `kind` is `person` or `group`. |
| `POST /api/contexts` | `{ name, kind, person?, people?, notes? }`. A person's context is unique and returned as it is (`created: false`); a group name is not created twice. |
| `POST /api/contexts/capture` | `{ text, kind?, person?, context?, url?, budget?, due?, remind_days_before?, source? }`. Only `text` is required; with no person and no context it lands in «Sin asignar». |
| `GET /api/contexts/upcoming?days=` | Items with a day inside their reminder window or the next `days` days, soonest first, each with `days_until` and `remind_now`. |
| `GET /api/contexts/:id` | The card: items grouped by kind, done ones, the person's next birthday and special dates, open commitments both ways, last contact and `awaiting_reply_days`. |
| `PATCH /api/contexts/:id` | `{ name?, notes?, people? }`; `people` replaces the members (names or ids). |
| `DELETE /api/contexts/:id` | Deletes the card and its items; the person is untouched. |
| `POST /api/contexts/:id/reply` | `{ since: "YYYY-MM-DD" \| null }`: the day a reply is owed, or `null` to clear it. |
| `POST /api/contexts/:id/items` | `{ kind, text, url?, budget?, due?, remind_days_before? }`; the same open item is not saved twice. |
| `PATCH /api/context-items/:id` | Any of `kind`, `text`, `url`, `budget`, `due`, `remind_days_before`, `status` (`open`, `done`, `dropped`). |
| `DELETE /api/context-items/:id` | Deletes one item. |
| `GET /api/people/:id/context` | The person's card, created the first time it is asked for. |

`remind_days_before` defaults to 21 when the item has a day: from that day on, the item reaches the daily digest (`digest.item`, kind `context`) once, and a plan or a pending thing with a day also goes on the family agenda and the `.ics` export. A context with `awaiting_reply_since` adds «sin contestar a…» with how many days. `/api/export` carries `contexts: { contexts, items, members }` and `/api/import` restores it onto the new people.
