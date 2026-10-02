# People's Hoard

Local-first personal CRM: who people are, what you know about them, when you last talked and what to remember — stored in a single SQLite file on your own computer and exposed to an assistant through MCP.

Spanish version: [`README.es.md`](README.es.md).

## Run

Requires Node.js 22.13 or later (it uses the built-in `node:sqlite` with FTS5). No native modules, no Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5182
```

`npm run open` starts the server and opens the browser on Windows. `npm run dev` runs the API (`node --watch`) and Vite together with the `/api` proxy configured automatically.

The server binds to `127.0.0.1` only. If port 5182 is busy it walks up to the next free port and prints the address; set `PORT_STRICT=1` to fail instead.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PEOPLE_PORT` / `PORT` | Preferred port (default `5182`). |
| `PORT_STRICT=1` | Do not fall back to another port. |
| `PEOPLE_DATA_DIR` | Data folder (default `<repo>/data`, gitignored). Contains `peoples-hoard.db` and `mcp-token`. |
| `PEOPLE_ALLOWED_HOSTS` | Extra host names accepted behind a tunnel (see below). |
| `PEOPLE_COMMITMENTS_AUTO=0` | Turn off the background sweep that reads meeting minutes from the Hoard Link hub (default on; see Commitments). |
| `HOARD_HUB_URL` / `HOARD_EVENTS=0` | Where the Hoard Link hub is (found by itself by default), and a switch to stop sending events. |
| `PEOPLE_URL` | MCP bridge: base URL of the running app (default `http://127.0.0.1:5182`). Must be local. |
| `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | MCP bridge: where to read the bearer token (default `<data dir>/mcp-token`). |

### Access from your phone (behind a tunnel)

The server binds 127.0.0.1 and only answers requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]`. To reach it from your phone through a tunnel that fronts the app (a private mesh network, a reverse proxy), list the extra host names in `PEOPLE_ALLOWED_HOSTS`, comma-separated, exact names or `*.suffix`: `PEOPLE_ALLOWED_HOSTS=my-pc.example,*.ts.net`. Port and letter case are ignored, and the `Origin` of API calls must resolve to one of those hosts too (any scheme or port). Cross-site *fetches* are still refused; opening the app from another page (a link, a bookmarklet, the share sheet) is a normal navigation and works.

Once opened through the tunnel, the browser offers to install it (PWA).

## What it does

- **Personas** — instant search (accent-insensitive, matches partial names anywhere in a word, plus nickname and alias), circle chips as a filter, cards with name, circles, "last contact 12 days ago" and a birthday-soon badge, and a quick new-person form.
- **Persona page** — a live conversation brief combining facts, five recent contacts and open reminders; header (name, nickname, circles, birthday, location, desired contact cadence) editable as one form; summary and notes as textareas that save on blur; facts as an editable key/value list ("le gusta" / "el senderismo"); a contact timeline with a one-line add form ("he hablado hoy"); reminders with due date and a "done" checkbox; an alias editor (WhatsApp, e-mail, phone, other handle); archive, merge-with-a-duplicate and delete.
- **Commitments** — who promised what to whom and by when, in two directions: what you owe a person (`i_owe`) and what a person owes you (`owed_to_me`). A page with filters (direction, status, person, overdue, text), a review queue, a form to add one, and the two ways to bring them in (below); a *Compromisos* section on every person page; a badge on the navigation with overdue items and proposals waiting. See *Commitments* below.
- **Agenda** — upcoming birthdays with age when the year is known, reminders due, a *Compromisos* block (overdue and due this week) and an "abandonados" list of people you have not contacted within their desired cadence, with a one-click "he hablado hoy" that logs a quick interaction. **Descargar calendario** exports active birthdays as yearly events, open reminders and open commitments with a due day as dated events in an `.ics` file.
- **Ajustes** — data folder and version, JSON export/import for backups.

### Commitments

A commitment has a direction (`i_owe` / `owed_to_me`), a person (or the name as written when they are not in the book), a text, a due day (`due`) or the words used (`due_text`), a status (`open`, `done`, `dropped`) and its source (`funes`, `chat`, `manual`, `text`, `mail`, with a reference and the literal quote). People's Hoard owns them; other apps only feed it.

- **From meetings.** Funes writes the minutes of a recorded meeting (summary, decisions and action items with evidence). People's Hoard asks for them through the Hoard Link hub (`scribe_minutes` on Funes, never by reading Funes's files) and turns each action item into a commitment: what *you* said you would do is `i_owe` (the other person is the counterpart), what someone else said is `owed_to_me`. Names resolve like everywhere else (exact, alias, fuzzy). Nothing goes straight into the list unless the direction and the person are both certain: a name that matches nobody or several people, an owner the minutes do not name (or give as `otros` or a speaker label such as `S1`), my own promise with no recipient the book knows, and a promise between two other people all go to a **review queue** instead. There you choose who owes (a promise made by *me* or *to me*), pick a candidate, create the person or discard; an item already in the list can be corrected the same way with *Editar* (direction, person, day). The meeting is logged once on each person's timeline as *Reunión: <title>*. While the hub answers, a sweep every 60 seconds reads `funes.minutes.ready` events (`GET <hub>/api/events?type=funes.minutes.ready&since_id=…`, with this app's token; the last id is remembered in the database; the first contact starts from "now", so old meetings are not replayed on their own: use `commitments_ingest_minutes` for those). `PEOPLE_COMMITMENTS_AUTO=0` switches the sweep off. To read a meeting again after a fix, `commitments_ingest_minutes(session_id, replace=true)` (add `regenerate=true` to have Funes write the minutes again) first drops what the earlier reading left that you have not touched (open, never edited, not chosen in the review queue; plus proposals still waiting) and then ingests; done, dropped, edited or deliberately discarded items stay.
- **From text.** Paste a mail or a conversation: the local model (through the hub) proposes commitments, each with the exact words that support it; proposals whose quote is not literally in the text are dropped, and everything goes to the review queue, never straight in. With no model loaded the answer is `no_model`.
- **From the assistant.** `commitment_add` records one said in a chat. A day is only kept if it is a real day or the words name exactly one ("el martes", "en dos semanas", "15 de octubre"); otherwise the words stay as `due_text`: nothing is guessed.
- **Events.** `people.commitment.added`, `people.commitment.done` and `people.commitment.overdue` (once per item; a new deadline earns a new one) are sent to the hub, so a rule can turn them into a notification.
- **Merge and delete.** Merging two people moves their commitments; deleting a person keeps their commitments with the name as written.

Birthdays are stored as `YYYY-MM-DD` (year known) or `--MM-DD` (year unknown); the upcoming window and age computation handle the Dec→Jan boundary and Feb 29 in non-leap years.

## API

All routes are JSON, validated with zod, and answer errors as `{ "error": "…" }` with a proper status code.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | `{ service: "peoples-hoard", version, dataDirConfigured }`, no auth. |
| `GET /api/state` | UI bootstrap: version, data dir, circle counts, commitment counts (open, overdue, proposals waiting). |
| `GET /api/people?q=&circle=&archived=` | Search/filter people (`archived`: `false` default, `true`, or `all`). |
| `GET/POST/PATCH/DELETE /api/people[/:id]` | People CRUD; `GET /:id` returns the full record. |
| `GET /api/people/:id/brief` | Live conversation brief with source ids, differing facts flagged and open commitments both ways. |
| `POST /api/people/merge` | `{ keep_id, drop_id }` — merges a duplicate into a person. |
| `POST/PATCH/DELETE /api/people/:id/aliases[/:id]`, `/facts`, `/interactions`, `/reminders` | Nested CRUD for each person. |
| `GET /api/resolve?name=` | Find a person by name/alias: exact → alias → fuzzy, with candidates and scores. |
| `GET /api/upcoming?days=30` | Birthdays in the window (with age when known), reminders due, and "neglected" people. |
| `GET /api/calendar.ics` | Download all active birthdays, open reminders and open commitments with a due day as iCalendar events; Feb 29 birthdays recur on leap years. |
| `GET/POST /api/commitments`, `GET/PATCH/DELETE /api/commitments/:id` | Commitments. List filters: `person`, `direction`, `status` (`open` default, `done`, `dropped`, `all`), `overdue=1`, `due_before`, `q`. The list also returns `pending_review`. |
| `GET /api/commitments/digest?days=7` | Overdue and upcoming, grouped by person, with ready-to-say lines. |
| `GET /api/commitments/review`, `POST /api/commitments/review/:id` | The review queue; `{ action: "accept" \| "discard", person_id \| create_person \| no_person, direction, text, due, due_text }`. |
| `POST /api/commitments/ingest` | `{ session_id, regenerate?, replace? }`: ask Funes for a meeting's minutes through the hub and ingest them. |
| `POST /api/commitments/extract` | `{ text, person_hint? }`: propose commitments from pasted text (to the review queue). |
| `GET/POST /api/commitments/sync` | State of the background sweep; `POST` runs one now. |
| `GET /api/circles` | Circle names with counts. |
| `GET /api/export` / `POST /api/import` | JSON backup and restore (people, aliases, facts, interactions, reminders and commitments). |
| `GET /api/agent/tools` | Tool catalogue (name, description, JSON schema, annotations) and the assistant instructions. |
| `POST /api/agent/call` | `{ name, arguments }` with `Authorization: Bearer <token>`; used by the MCP bridge. |

## Connect an assistant (MCP)

`server/mcp.js` is a stdio MCP server that proxies every call to the running app, so only one process ever opens the database. Keep the app running while the assistant works.

```json
{
  "command": "node",
  "args": ["C:/path/to/peoples-hoard/server/mcp.js"],
  "env": { "PEOPLE_URL": "http://127.0.0.1:5182", "PEOPLE_TOKEN_FILE": "C:/path/to/peoples-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describes the app for Faustus (health check, launch hint and the MCP command with placeholders).

Tools (22):

| Tool | Purpose |
| --- | --- |
| `find_people` | Fuzzy, accent-insensitive, partial-name search over people, nicknames and aliases; returns scored candidates. |
| `get_person` | Full record: facts, last 10 interactions, open reminders, open commitments both ways, days since last contact. |
| `prepare_person_chat` | Compact conversation brief, recomputed after edits, with source ids and conflicting fact values flagged. |
| `upsert_person` | Create or update a person by id/exact name; all fields besides name are partial. |
| `add_alias` | Attach a WhatsApp/e-mail/phone/other handle so future messages resolve to a person; idempotent. |
| `add_fact` | Record a free-form key/value fact ("le gusta" / "el senderismo"); idempotent. |
| `log_interaction` | Log a contact and update when you last spoke. |
| `add_reminder` | Create a reminder, optionally tied to a person. |
| `complete_reminder` | Mark a reminder done. |
| `upcoming` | Birthdays, reminders due and neglected people within N days, with a one-line summary. |
| `list_people` | List people, optionally filtered by circle. |
| `commitments_list` | Commitments filtered by person, direction, status, overdue and due date. |
| `commitment_add` | Record a promise: I owe someone something, or they owe me. Words like "el viernes" become a date when they name one day. |
| `commitment_update` | Change text, day, person or direction of a commitment. |
| `commitment_done` / `commitment_drop` | Mark a commitment fulfilled, or no longer applicable. |
| `commitments_review` | List the review queue, or settle one proposal (accept with a person, or discard). Asks the user first. |
| `commitments_ingest_minutes` | Ask Funes (through the hub) for a meeting's minutes and record their action items (`replace` re-reads a meeting, dropping what the user has not touched; `regenerate` rewrites the minutes). Reports `no_model`, `hub_down`, `tool_missing`, `unknown_session` or `funes_error` instead of failing. |
| `commitments_extract_text` | Propose commitments from pasted text with the local model; they go to the review queue. |
| `commitments_digest` | What is overdue and due soon, in words: "le debes a X…", "X te debe…". |
| `merge_people` | Merge a duplicate into another person; commitments move too (destructive). |
| `delete_person` | Delete a person and everything linked to them; commitments stay with the name as written (destructive). |

Every description ends with a `Sinónimos:` line of Spanish words. Ambiguous names return `candidates` so the assistant can ask instead of guessing — two people can share a first name.

## Data and limits

- `data/peoples-hoard.db` — SQLite in WAL mode; schema migrations in `server/db.js` (`schema_version` table); a hand-maintained FTS5 index (`people_fts`) over name, nickname, aliases, summary, notes and facts, with accent folding when the SQLite build supports it.
- `data/mcp-token` — 32 random bytes written at every start; never committed.
- Search combines a fold-based substring pass (catches mid-word partial matches and accents) with an FTS5 prefix pass for broader recall over notes/facts.
- Requests are accepted only from `localhost` / `127.0.0.1` origins; cross-site requests are rejected.
- An alias's `kind` + `value` is globally unique: one WhatsApp name, e-mail or phone number can only ever resolve to one person.
- The only network calls are to the local Hoard Link hub (events, the Funes minutes proxy and the local model); when it is not there the app works as before and says so where it matters.

## Verification

```sh
npm test        # node --test tests/*.test.js — dates/folding, domain logic, HTTP API, agent auth and tools, commitments (with a fake hub)
npm run build   # vite build → dist/
```

Tests use temporary data directories and never touch `data/`.

## Layout

```
server/   app.js (Express), index.js (boot), db.js, people.js, aliases.js, facts.js,
          interactions.js, reminders.js, commitments.js, commitments-poller.js, due.js, hoard-link.js, upcoming.js, dates.js, text.js, routes.js,
          agent-tools.js, agent-routes.js, mcp.js, port.js
client/   React 19 + Vite + Tailwind v4 (pages: Personas, Persona, Agenda, Compromisos, Ajustes)
scripts/  launch.mjs, dev.mjs
tests/    node:test suites
```

License: MIT (see `LICENSE`).
