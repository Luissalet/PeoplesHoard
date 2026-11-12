# People's Hoard

A local personal CRM: who people are, what you know about them, when you last talked, what you promised each other and what to remember, stored in one SQLite file on your own computer.

Spanish version: [`README.es.md`](README.es.md).

## What it is

People's Hoard is a small web app (Express + React) that works as an address book with memory. For each person it keeps circles, nicknames and aliases, a birthday and special dates, free-form facts, a contact timeline, reminders, gift ideas and the commitments between you. It tells you whom you have neglected, what is due and what to say when you meet.

The same data is exposed to an assistant through MCP. It is one app of the Hoard family and works on its own; with the family hub or Faustus running it can also read mail for last contacts, extract commitments from meetings and messages, and feed the daily digest. The interface is in Spanish.

## What it does

**People**
- Instant search that ignores accents and matches partial names, nicknames and aliases, with circle chips as a filter; cards show circles, "last contact 12 days ago" and a birthday-soon badge.
- Person page: a live conversation brief (facts, five recent contacts, open reminders), editable header (name, nickname, circles, birthday, location, desired contact cadence), summary and notes that save on blur, an editable key/value fact list and aliases (WhatsApp name, e-mail, phone) so incoming messages resolve to the right person.
- Special dates per person (anniversary, saint's day, one-off or yearly, with or without year) next to the birthday.
- Gift ideas per person with optional page and budget; a price or stock watcher can be requested from the product-watching app.
- Merge duplicates (the kept person also receives what it lacked) and delete, and **Buscar duplicados** to find likely pairs by name similarity, same e-mail or phone, or same birthday; it never merges on its own.
- **Prepárame**: a written catch-up before seeing someone (what you talked about, what you owe each other, open reminders, upcoming dates, an opening question), written by the family model, or a plain outline when none is available.

**Contact history**
- A timeline per person with channel, summary and an optional date and time; adding an older conversation never moves the last-contact date backwards.
- **Consultar historial** searches the whole recorded history (accent-insensitive, by person, channel, day and archived people, with exact totals) and **Descargar historial** exports every match as JSON or CSV. See [`docs/interaction-history.md`](docs/interaction-history.md) and [`docs/history-export.md`](docs/history-export.md).

**Commitments**
- Who promised what to whom and by when, in both directions (`i_owe`, `owed_to_me`), with status (open, done, dropped) and source. Filters, a review queue, a balance view of what you owe and are owed per person, and a section on every person page.
- Ways in: manual, from a pasted mail or conversation (the local model proposes, with the literal supporting quote, and everything goes to review), from meeting minutes, from a meeting analysis of the requirements app, and from batches of chat messages that Faustus hands over for chats the user enabled (this app never reads WhatsApp itself).
- Spoken days ("el viernes", "en dos semanas", "15 de octubre") become dates only when unambiguous; otherwise the words are kept and nothing is guessed.

**Agenda and reminders**
- Upcoming birthdays with age, reminders due, overdue and near commitments, and abandoned people (not contacted within their cadence) with a one-click "he hablado hoy".
- Cooling contacts: people with at least two contacts and none for 90 days by default (adjustable).
- Reminders with a due date, optionally tied to a person.
- **Descargar calendario** exports birthdays, special dates, reminders and dated commitments as an `.ics` file.

**Import, export and backup**
- **Importar contactos** reads `.vcf` files (vCard 2.1, 3.0, 4.0), shows what would happen and imports on a click, only filling empty fields.
- **Exportar contactos** downloads selected contacts as vCard 4.0.
- JSON export and import for backups in Ajustes.

**In the background**
- Every hour, nudges go to the family daily digest: commitments due or overdue, reminders for today, birthdays and special dates a week ahead and on the day, and cooling relationships. Each is sent once.
- Every 30 minutes the hub's mail is read for the e-mail aliases in the book to keep the last contact (date, channel and subject, never the body).
- Optionally the last contact is updated from WhatsApp batches, one line per person and day, never message text.

## Run it

Requires Node.js 22.13 or later (built-in `node:sqlite` with FTS5). No native modules, no Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5182
```

`npm run open` starts the server and opens the browser on Windows. `npm run dev` runs the API and Vite together. The server binds to `127.0.0.1`; if the port is busy it takes the next free one unless `PORT_STRICT=1`.

| Variable | Purpose |
| --- | --- |
| `PEOPLE_PORT` / `PORT` | Preferred port (default `5182`). |
| `PORT_STRICT=1` | Do not fall back to another port. |
| `PEOPLE_DATA_DIR` | Data folder (default `./data`, gitignored). |
| `PEOPLE_ALLOWED_HOSTS` | Extra host names accepted behind a tunnel, comma-separated, exact or `*.suffix`. |
| `PEOPLE_MAIL_AUTO=0` | Turn off the periodic mail pass for last contact. |
| `PEOPLE_COMMITMENTS_AUTO=0` | Turn off the background sweep that reads meeting minutes. |
| `HOARD_HUB_URL` / `HOARD_EVENTS=0` | Where the family hub is (found automatically by default) and a switch to stop sending events. |
| `PEOPLE_URL`, `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | MCP bridge: app URL and bearer token location. |
| `HOARD_COPILOT=0` | Disable the Faustus copilot button and routes. |

Behind a private tunnel, list the host names in `PEOPLE_ALLOWED_HOSTS`; the browser then offers to install the app as a PWA.

## Connect an assistant (MCP)

`server/mcp.js` is a stdio MCP server that proxies every call to the running app, so only one process opens the database. Keep the app running while the assistant works.

```json
{
  "command": "node",
  "args": ["C:/path/to/peoples-hoard/server/mcp.js"],
  "env": { "PEOPLE_URL": "http://127.0.0.1:5182", "PEOPLE_TOKEN_FILE": "C:/path/to/peoples-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describes the app for Faustus. Tools by group (the full catalogue is at `GET /api/agent/tools`; REST routes are in [`docs/API.md`](docs/API.md)):

| Area | Tools |
| --- | --- |
| People | `find_people`, `get_person`, `list_people`, `upsert_person`, `add_alias`, `add_fact`, `find_duplicate_people`, `merge_people`, `delete_person`, `person_date_add`, `person_date_remove` |
| History | `log_interaction`, `search_interactions`, `export_interactions` |
| Reminders and agenda | `add_reminder`, `complete_reminder`, `upcoming`, `people_nudges` |
| Commitments | `commitments_list`, `commitment_add`, `commitment_update`, `commitment_done`, `commitment_drop`, `commitments_review`, `commitments_digest`, `commitments_ingest_minutes`, `commitments_extract_text`, `commitments_from_messages`, `commitments_import_talos` |
| Preparation | `prepare_person_chat`, `prepare_to_meet`, `people_from_minutes` |
| Mail and gifts | `contacts_sync_mail`, `gift_idea_add`, `gift_ideas`, `gift_watch` |
| vCard | `import_people_vcard`, `export_people_vcard` |

Names are matched fuzzily; ambiguous names return candidates so the assistant can ask, since two people can share a first name. Destructive tools (merge, delete) ask first.

## Connection with Faustus and the Hoard family

- **Copilot**: every page has a floating Faustus button that opens the assistant in a side panel. The conversation lives in Faustus; this app relays it and tells the assistant the page, filters, the person on screen and the form being edited. After each turn the page reloads its data without losing what you typed, and edits save only the fields you changed.
- **Hub**: events and the daily digest, the local model for catch-ups and commitment extraction, the mail gateway, meeting minutes from the recording app, product watchers, and the family agenda (`GET /api/family/agenda`: birthdays, follow-ups by cadence, open commitments with a day). Without the hub the app works as before and says so where it matters.
- **Skills**: `faustus-plugin.json` names the family skills `personal-crm-follow-ups` and `hoard-meeting-prep`.

## Data and security

- `data/peoples-hoard.db`: SQLite in WAL mode with versioned migrations and a full-text index over names, aliases, notes and facts. `data/mcp-token`: a random token written at every start, never committed.
- An alias (kind + value) resolves to exactly one person. E-mails and phone numbers are compared in normalised form.
- Requests are accepted only from `localhost` / `127.0.0.1` hosts and origins (plus `PEOPLE_ALLOWED_HOSTS`); cross-site requests are rejected.
- The only network calls go to the local hub. Birthdays are stored as `YYYY-MM-DD` or `--MM-DD` (year unknown), handling 29 February.

## Project layout

| Path | Contents |
| --- | --- |
| `server/` | Express API, SQLite access, people, aliases, duplicates, interactions, commitments, mail sync, gifts, agenda, calendar export, MCP bridge |
| `server/hoard-commons/`, `server/hoard-link.js` | Vendored shared code of the Hoard family; do not edit here |
| `client/` | React 19 + Vite + Tailwind v4 (Personas, Persona, Agenda, Compromisos, Ajustes) |
| `docs/` | API reference and history documentation |
| `scripts/` | `launch.mjs`, `dev.mjs` |
| `tests/` | `node:test` suites |

```sh
npm test         # node --test tests/*.test.js
npm run build    # vite build -> dist/
```

Tests use temporary data directories and never touch `data/`.

License: MIT (see `LICENSE`).
