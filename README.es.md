# People's Hoard

CRM personal local: quién es quién, qué sabes de cada persona, cuándo hablasteis por última vez, qué os habéis prometido y qué recordar, guardado en un único archivo SQLite en tu propio ordenador.

English version: [`README.md`](README.md).

## Qué es

People's Hoard es una pequeña aplicación web (Express + React) que funciona como una agenda con memoria. De cada persona guarda círculos, apodos y alias, cumpleaños y fechas especiales, datos libres, una línea de contactos, recordatorios, ideas de regalo y los compromisos entre vosotros. Te dice a quién has descuidado, qué vence y qué decir cuando os veáis.

Los mismos datos se ofrecen a un asistente por MCP. Es una app de la familia Hoard y funciona sola; con el hub de la familia o Faustus en marcha también lee el correo para los últimos contactos, extrae compromisos de reuniones y mensajes y alimenta el resumen diario. La interfaz está en español.

## Qué hace

**Personas**
- Búsqueda instantánea sin acentos que encuentra nombres parciales, apodos y alias, con chips de círculo como filtro; las tarjetas muestran círculos, «último contacto hace 12 días» y una insignia de cumpleaños cercano.
- Ficha de la persona: resumen vivo para conversar (datos, cinco contactos recientes, recordatorios abiertos), cabecera editable (nombre, apodo, círculos, cumpleaños, lugar, cadencia de contacto deseada), resumen y notas que se guardan al salir del campo, lista editable de datos clave/valor y alias (nombre de WhatsApp, correo, teléfono) para que los mensajes entrantes se asocien a la persona correcta.
- Fechas especiales por persona (aniversario, santo, únicas o anuales, con o sin año) junto al cumpleaños.
- Ideas de regalo por persona con página y presupuesto opcionales; se puede pedir a la app de vigilancia de productos que vigile precio o stock.
- Fusionar duplicados (la persona que se conserva recibe también lo que le faltaba) y borrar, y **Buscar duplicados** para localizar pares probables por parecido de nombre, mismo correo o teléfono o mismo cumpleaños; nunca fusiona por su cuenta.
- **Prepárame**: un repaso escrito antes de ver a alguien (de qué hablasteis, qué os debéis, recordatorios abiertos, fechas próximas, una pregunta para empezar), redactado por el modelo de la familia, o un esquema simple si no hay modelo.

**Historial de contactos**
- Línea temporal por persona con canal, resumen y fecha y hora opcionales; añadir una conversación antigua nunca retrasa la fecha del último contacto.
- **Consultar historial** busca en todo el historial registrado (sin acentos, por persona, canal, día y personas archivadas, con totales exactos) y **Descargar historial** exporta todas las coincidencias en JSON o CSV. Véanse [`docs/interaction-history.md`](docs/interaction-history.md) y [`docs/history-export.md`](docs/history-export.md).

**Compromisos**
- Quién prometió qué a quién y para cuándo, en ambos sentidos (`i_owe`, `owed_to_me`), con estado (abierto, hecho, descartado) y origen. Filtros, cola de revisión, vista de balance de lo que debes y te deben por persona, y una sección en cada ficha.
- Formas de entrada: manual, desde un correo o conversación pegados (el modelo local propone con la cita literal que lo respalda y todo pasa por revisión), desde actas de reuniones, desde un análisis de reunión de la app de requisitos y desde lotes de mensajes de chat que entrega Faustus de los chats que el usuario habilitó (esta app nunca lee WhatsApp por sí misma).
- Los días dichos de palabra («el viernes», «en dos semanas», «15 de octubre») se convierten en fecha solo si no hay ambigüedad; si no, se conservan las palabras y no se adivina nada.

**Agenda y recordatorios**
- Próximos cumpleaños con edad, recordatorios vencidos, compromisos vencidos o cercanos y personas abandonadas (sin contacto dentro de su cadencia) con un «he hablado hoy» de un clic.
- Contactos que se enfrían: personas con al menos dos contactos y ninguno en 90 días por defecto (ajustable).
- Recordatorios con fecha, opcionalmente ligados a una persona.
- **Descargar calendario** exporta cumpleaños, fechas especiales, recordatorios y compromisos con fecha en un archivo `.ics`.

**Importar, exportar y copias**
- **Importar contactos** lee archivos `.vcf` (vCard 2.1, 3.0, 4.0), muestra qué pasaría e importa con un clic, rellenando solo campos vacíos.
- **Exportar contactos** descarga los contactos seleccionados en vCard 4.0.
- Exportación e importación JSON para copias de seguridad en Ajustes.

**En segundo plano**
- Cada hora se envían avisos al resumen diario de la familia: compromisos vencidos o que vencen, recordatorios de hoy, cumpleaños y fechas especiales con una semana de antelación y el mismo día, y relaciones que se enfrían. Cada uno se envía una sola vez.
- Cada 30 minutos se lee el correo del hub para los alias de correo de la agenda y se actualiza el último contacto (fecha, canal y asunto, nunca el cuerpo).
- Opcionalmente, el último contacto se actualiza con lotes de WhatsApp, una línea por persona y día, nunca el texto de los mensajes.

## Cómo se ejecuta

Requiere Node.js 22.13 o posterior (`node:sqlite` integrado con FTS5). Sin módulos nativos ni Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5182
```

`npm run open` arranca el servidor y abre el navegador en Windows. `npm run dev` ejecuta la API y Vite a la vez. El servidor escucha solo en `127.0.0.1`; si el puerto está ocupado toma el siguiente libre, salvo con `PORT_STRICT=1`.

| Variable | Para qué sirve |
| --- | --- |
| `PEOPLE_PORT` / `PORT` | Puerto preferido (por defecto `5182`). |
| `PORT_STRICT=1` | No pasar a otro puerto. |
| `PEOPLE_DATA_DIR` | Carpeta de datos (por defecto `./data`, ignorada por git). |
| `PEOPLE_ALLOWED_HOSTS` | Nombres de host extra aceptados tras un túnel, separados por comas, exactos o `*.sufijo`. |
| `PEOPLE_MAIL_AUTO=0` | Desactivar la pasada periódica de correo para el último contacto. |
| `PEOPLE_COMMITMENTS_AUTO=0` | Desactivar el barrido en segundo plano que lee actas de reuniones. |
| `HOARD_HUB_URL` / `HOARD_EVENTS=0` | Dónde está el hub de la familia (se encuentra solo por defecto) e interruptor para dejar de enviar eventos. |
| `PEOPLE_URL`, `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | Puente MCP: URL de la app y ubicación del token. |
| `HOARD_COPILOT=0` | Desactivar el botón y las rutas del copiloto de Faustus. |

Tras un túnel privado, indica los nombres de host en `PEOPLE_ALLOWED_HOSTS`; el navegador ofrecerá entonces instalar la app como PWA.

## Conectar un asistente (MCP)

`server/mcp.js` es un servidor MCP por stdio que reenvía cada llamada a la app en marcha, de modo que solo un proceso abre la base de datos. Mantén la app abierta mientras trabaje el asistente.

```json
{
  "command": "node",
  "args": ["C:/ruta/a/peoples-hoard/server/mcp.js"],
  "env": { "PEOPLE_URL": "http://127.0.0.1:5182", "PEOPLE_TOKEN_FILE": "C:/ruta/a/peoples-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describe la app para Faustus. Herramientas por grupos (el catálogo completo está en `GET /api/agent/tools`; las rutas REST, en [`docs/API.md`](docs/API.md)):

| Área | Herramientas |
| --- | --- |
| Personas | `find_people`, `get_person`, `list_people`, `upsert_person`, `add_alias`, `add_fact`, `find_duplicate_people`, `merge_people`, `delete_person`, `person_date_add`, `person_date_remove` |
| Historial | `log_interaction`, `search_interactions`, `export_interactions` |
| Recordatorios y agenda | `add_reminder`, `complete_reminder`, `upcoming`, `people_nudges` |
| Compromisos | `commitments_list`, `commitment_add`, `commitment_update`, `commitment_done`, `commitment_drop`, `commitments_review`, `commitments_digest`, `commitments_ingest_minutes`, `commitments_extract_text`, `commitments_from_messages`, `commitments_import_talos` |
| Preparación | `prepare_person_chat`, `prepare_to_meet`, `people_from_minutes` |
| Correo y regalos | `contacts_sync_mail`, `gift_idea_add`, `gift_ideas`, `gift_watch` |
| vCard | `import_people_vcard`, `export_people_vcard` |

Los nombres se resuelven de forma aproximada; si son ambiguos se devuelven candidatos para que el asistente pregunte, ya que dos personas pueden compartir nombre de pila. Las herramientas destructivas (fusionar, borrar) piden confirmación.

## Conexión con Faustus y la familia Hoard

- **Copiloto**: cada página tiene un botón flotante de Faustus que abre el asistente en un panel lateral. La conversación vive en Faustus; esta app la retransmite e informa al asistente de la página, los filtros, la persona en pantalla y el formulario que editas. Tras cada turno la página recarga sus datos sin perder lo escrito, y las ediciones guardan solo los campos que cambiaste.
- **Hub**: eventos y resumen diario, modelo local para repasos y extracción de compromisos, pasarela de correo, actas de la app de grabación de reuniones, vigilantes de productos y agenda familiar (`GET /api/family/agenda`: cumpleaños, seguimientos según cadencia, compromisos abiertos con fecha). Sin el hub la app funciona igual y lo dice donde importa.
- **Skills**: `faustus-plugin.json` nombra las skills familiares `personal-crm-follow-ups` y `hoard-meeting-prep`.

## Datos y seguridad

- `data/peoples-hoard.db`: SQLite en modo WAL con migraciones versionadas e índice de texto completo sobre nombres, alias, notas y datos. `data/mcp-token`: token aleatorio que se escribe en cada arranque y nunca se sube a git.
- Un alias (tipo + valor) pertenece a una sola persona. Los correos y teléfonos se comparan en forma normalizada.
- Solo se aceptan peticiones de hosts y orígenes `localhost` / `127.0.0.1` (más `PEOPLE_ALLOWED_HOSTS`); las peticiones entre sitios se rechazan.
- Las únicas llamadas de red van al hub local. Los cumpleaños se guardan como `YYYY-MM-DD` o `--MM-DD` (año desconocido), contemplando el 29 de febrero.

## Estructura del proyecto

| Ruta | Contenido |
| --- | --- |
| `server/` | API Express, acceso a SQLite, personas, alias, duplicados, interacciones, compromisos, sincronización de correo, regalos, agenda, exportación de calendario, puente MCP |
| `server/hoard-commons/`, `server/hoard-link.js` | Código común de la familia Hoard incluido tal cual; no se edita aquí |
| `client/` | React 19 + Vite + Tailwind v4 (Personas, Persona, Agenda, Compromisos, Ajustes) |
| `docs/` | Referencia de la API y documentación del historial |
| `scripts/` | `launch.mjs`, `dev.mjs` |
| `tests/` | Suites de `node:test` |

```sh
npm test         # node --test tests/*.test.js
npm run build    # vite build -> dist/
```

Las pruebas usan carpetas de datos temporales y nunca tocan `data/`.

Licencia: MIT (véase `LICENSE`).
