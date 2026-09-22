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
| `PEOPLE_URL` | MCP bridge: base URL of the running app (default `http://127.0.0.1:5182`). Must be local. |
| `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | MCP bridge: where to read the bearer token (default `<data dir>/mcp-token`). |

## What it does

- **Personas** — instant search (accent-insensitive, matches partial names anywhere in a word, plus nickname and alias), circle chips as a filter, cards with name, circles, "last contact 12 days ago" and a birthday-soon badge, and a quick new-person form.
- **Persona page** — header (name, nickname, circles, birthday, location, desired contact cadence) editable as one form; summary and notes as textareas that save on blur; facts as an editable key/value list ("le gusta" / "el senderismo"); a contact timeline with a one-line add form ("he hablado hoy"); reminders with due date and a "done" checkbox; an alias editor (WhatsApp, e-mail, phone, other handle); archive, merge-with-a-duplicate and delete.
- **Agenda** — upcoming birthdays with age when the year is known, reminders due, and an "abandonados" list of people you have not contacted within their desired cadence, with a one-click "he hablado hoy" that logs a quick interaction.
- **Ajustes** — data folder and version, JSON export/import for backups.

Birthdays are stored as `YYYY-MM-DD` (year known) or `--MM-DD` (year unknown); the upcoming window and age computation handle the Dec→Jan boundary and Feb 29 in non-leap years.

## API

All routes are JSON, validated with zod, and answer errors as `{ "error": "…" }` with a proper status code.

| Route | Purpose |
| --- | --- |
| `GET /api/health` | `{ service: "peoples-hoard", version, dataDirConfigured }`, no auth. |
| `GET /api/state` | UI bootstrap: version, data dir, circle counts. |
| `GET /api/people?q=&circle=&archived=` | Search/filter people (`archived`: `false` default, `true`, or `all`). |
| `GET/POST/PATCH/DELETE /api/people[/:id]` | People CRUD; `GET /:id` returns the full record. |
| `POST /api/people/merge` | `{ keep_id, drop_id }` — merges a duplicate into a person. |
| `POST/PATCH/DELETE /api/people/:id/aliases[/:id]`, `/facts`, `/interactions`, `/reminders` | Nested CRUD for each person. |
| `GET /api/resolve?name=` | Find a person by name/alias: exact → alias → fuzzy, with candidates and scores. |
| `GET /api/upcoming?days=30` | Birthdays in the window (with age when known), reminders due, and "neglected" people. |
| `GET /api/circles` | Circle names with counts. |
| `GET /api/export` / `POST /api/import` | JSON backup and restore. |
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

Tools (12):

| Tool | Purpose |
| --- | --- |
| `find_people` | Fuzzy, accent-insensitive, partial-name search over people, nicknames and aliases; returns scored candidates. |
| `get_person` | Full record: facts, last 10 interactions, open reminders, days since last contact. |
| `upsert_person` | Create or update a person by id/exact name; all fields besides name are partial. |
| `add_alias` | Attach a WhatsApp/e-mail/phone/other handle so future messages resolve to a person; idempotent. |
| `add_fact` | Record a free-form key/value fact ("le gusta" / "el senderismo"); idempotent. |
| `log_interaction` | Log a contact and update when you last spoke. |
| `add_reminder` | Create a reminder, optionally tied to a person. |
| `complete_reminder` | Mark a reminder done. |
| `upcoming` | Birthdays, reminders due and neglected people within N days, with a one-line summary. |
| `list_people` | List people, optionally filtered by circle. |
| `merge_people` | Merge a duplicate into another person (destructive). |
| `delete_person` | Delete a person and everything linked to them (destructive). |

Every description ends with a `Sinónimos:` line of Spanish words. Ambiguous names return `candidates` so the assistant can ask instead of guessing — two people can share a first name.

## Data and limits

- `data/peoples-hoard.db` — SQLite in WAL mode; schema migrations in `server/db.js` (`schema_version` table); a hand-maintained FTS5 index (`people_fts`) over name, nickname, aliases, summary, notes and facts, with accent folding when the SQLite build supports it.
- `data/mcp-token` — 32 random bytes written at every start; never committed.
- Search combines a fold-based substring pass (catches mid-word partial matches and accents) with an FTS5 prefix pass for broader recall over notes/facts.
- Requests are accepted only from `localhost` / `127.0.0.1` origins; cross-site requests are rejected.
- An alias's `kind` + `value` is globally unique: one WhatsApp name, e-mail or phone number can only ever resolve to one person.
- The server makes no network calls.

## Verification

```sh
npm test        # node --test tests/*.test.js — dates/folding, domain logic, HTTP API, agent auth and tools
npm run build   # vite build → dist/
```

Tests use temporary data directories and never touch `data/`.

## Layout

```
server/   app.js (Express), index.js (boot), db.js, people.js, aliases.js, facts.js,
          interactions.js, reminders.js, upcoming.js, dates.js, text.js, routes.js,
          agent-tools.js, agent-routes.js, mcp.js, port.js
client/   React 19 + Vite + Tailwind v4 (pages: Personas, Persona, Agenda, Ajustes)
scripts/  launch.mjs, dev.mjs
tests/    node:test suites
```

License: MIT (see `LICENSE`).
