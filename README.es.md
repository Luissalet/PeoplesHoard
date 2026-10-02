# People's Hoard

Agenda personal local: quién es cada persona, qué sabéis de ella, cuándo hablasteis por última vez y qué recordar. Todo se guarda en un único archivo SQLite en vuestro ordenador y se expone a un asistente mediante MCP.

English version: [`README.md`](README.md).

## Abrir

Necesita Node.js 22.13 o posterior (usa el `node:sqlite` integrado con FTS5). Sin módulos nativos ni Docker.

```sh
npm install
npm run build
npm start          # http://127.0.0.1:5182
```

`npm run open` arranca el servidor y abre el navegador en Windows. `npm run dev` ejecuta la API (`node --watch`) y Vite a la vez con el proxy de `/api` configurado solo.

El servidor escucha únicamente en `127.0.0.1`. Si el puerto 5182 está ocupado avanza al siguiente libre y muestra la dirección; con `PORT_STRICT=1` falla en lugar de cambiar.

### Variables de entorno

| Variable | Uso |
| --- | --- |
| `PEOPLE_PORT` / `PORT` | Puerto preferido (por defecto `5182`). |
| `PORT_STRICT=1` | No buscar otro puerto. |
| `PEOPLE_DATA_DIR` | Carpeta de datos (por defecto `<repo>/data`, ignorada por git). Contiene `peoples-hoard.db` y `mcp-token`. |
| `PEOPLE_ALLOWED_HOSTS` | Nombres de host adicionales aceptados detrás de un túnel (ver más abajo). |
| `PEOPLE_MAIL_AUTO=0` | Apaga la pasada de cada 30 minutos que lee el correo del hub para el último contacto (por defecto activa; ver Con el resto de la familia). |
| `PEOPLE_COMMITMENTS_AUTO=0` | Apaga el sondeo que lee las actas de reuniones desde el hub de Hoard Link (por defecto activo; ver Compromisos). |
| `HOARD_HUB_URL` / `HOARD_EVENTS=0` | Dónde está el hub de Hoard Link (lo encuentra solo) y un interruptor para dejar de enviar eventos. |
| `PEOPLE_URL` | Puente MCP: URL de la aplicación (por defecto `http://127.0.0.1:5182`). Debe ser local. |
| `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | Puente MCP: de dónde leer el token (por defecto `<datos>/mcp-token`). |

### Acceso desde el móvil (a través de un túnel)

El servidor escucha en 127.0.0.1 y solo responde a peticiones cuyo `Host` sea `localhost`, `127.0.0.1` o `[::1]`. Para entrar desde el móvil a través de un túnel que ponga la aplicación delante (una red privada, un proxy inverso), indicad los nombres de host adicionales en `PEOPLE_ALLOWED_HOSTS`, separados por comas, exactos o `*.sufijo`: `PEOPLE_ALLOWED_HOSTS=mi-pc.example,*.ts.net`. El puerto y las mayúsculas no importan, y el `Origin` de las llamadas a la API también tiene que corresponder a uno de esos hosts (con cualquier esquema o puerto). Las peticiones *fetch* desde otras webs se siguen rechazando; abrir la aplicación desde otra página (un enlace, un bookmarklet, el menú de compartir) es una navegación normal y funciona.

Una vez abierta a través del túnel, el navegador ofrece instalarla (PWA).

## Qué hace

- **Personas** — búsqueda instantánea (sin distinguir acentos, encuentra nombres parciales en cualquier parte de la palabra, también por apodo y alias), chips de círculo como filtro, tarjetas con nombre, círculos, «hace 12 días» del último contacto y una insignia de cumpleaños próximo, y un formulario rápido de alta.
- **Ficha de persona** — preparación de conversación en vivo con datos, cinco contactos recientes y recordatorios abiertos; cabecera (nombre, apodo, círculos, cumpleaños, ubicación, cadencia de contacto deseada) editable como un único formulario; resumen y notas en textareas que se guardan al salir del campo; datos como lista de clave/valor editable («le gusta» / «el senderismo»); línea de tiempo de contactos con un formulario de una línea («he hablado hoy»); recordatorios con fecha y una casilla «hecho»; editor de alias (WhatsApp, correo, teléfono, otro identificador); archivar, fusionar con un duplicado y borrar.
- **Compromisos** — quién prometió qué a quién y para cuándo, en los dos sentidos: lo que tú debes a una persona (`i_owe`) y lo que ella te debe a ti (`owed_to_me`). Una página con filtros (sentido, estado, persona, vencidos, texto), una cola de revisión, un formulario para anotar uno y las dos vías para traerlos (abajo); una sección *Compromisos* en cada ficha; y una insignia en la navegación con los vencidos y las propuestas en espera.
- **Agenda** — próximos cumpleaños con la edad cuando se conoce el año, recordatorios pendientes, un bloque *Compromisos* (vencidos y de esta semana) y una lista de «abandonados»: personas con las que no habláis dentro de la cadencia deseada, con un botón «he hablado hoy» que apunta un contacto rápido al instante. **Descargar calendario** exporta los cumpleaños, los recordatorios abiertos y los compromisos abiertos con fecha a un archivo `.ics`.
- **Ajustes** — carpeta de datos y versión, exportación/importación JSON para copias de seguridad.

### Compromisos

Un compromiso tiene un sentido (`i_owe` / `owed_to_me`), una persona (o el nombre tal como se dijo si no está en la agenda), un texto, un día (`due`) o las palabras usadas (`due_text`), un estado (`open`, `done`, `dropped`) y su origen (`funes`, `chat`, `manual`, `text`, `mail`, con referencia y la cita literal). Los guarda People's Hoard; las demás aplicaciones solo le pasan material.

- **De las reuniones.** Funes escribe el acta de una reunión grabada (resumen, decisiones y tareas con su evidencia). People's Hoard la pide a través del hub de Hoard Link (`scribe_minutes` en Funes, sin leer nunca los archivos de Funes) y convierte cada tarea en un compromiso: lo que dijiste *tú* que harías es `i_owe` (la otra persona es la contraparte); lo que dijo otra persona es `owed_to_me`. Los nombres se resuelven como en el resto de la aplicación (exacto, alias, aproximado). Nada entra directo en la lista si el sentido y la persona no son seguros: un nombre que no coincide con nadie o con varias personas, un responsable que el acta no nombra (o que figura como `otros` o una etiqueta de hablante como `S1`), una promesa mía sin destinatario conocido y una promesa entre otras dos personas van a una **cola de revisión**. Allí eliges quién debe (una promesa hecha *por mí* o *a mí*), un candidato, crear la persona o descartar; un elemento que ya está en la lista se corrige igual con *Editar* (sentido, persona, día). La reunión se apunta una sola vez en la línea de tiempo de cada persona como *Reunión: <título>*. Mientras el hub responde, un sondeo cada 60 segundos lee los eventos `funes.minutes.ready` (`GET <hub>/api/events?type=funes.minutes.ready&since_id=…`, con el token de esta aplicación; el último id queda guardado en la base de datos; en el primer contacto empieza desde «ahora», así que no se reprocesan solas las reuniones antiguas: para esas está `commitments_ingest_minutes`). `PEOPLE_COMMITMENTS_AUTO=0` apaga el sondeo. Para releer una reunión tras una corrección, `commitments_ingest_minutes(session_id, replace=true)` (con `regenerate=true` Funes reescribe el acta) quita primero lo que dejó la lectura anterior y no has tocado (abierto, sin editar, no elegido en la cola; y las propuestas en espera) y luego vuelve a leer; lo cumplido, descartado, editado o descartado a propósito se queda.
- **De un texto.** Pega un correo o una conversación: el modelo local (a través del hub) propone compromisos, cada uno con las palabras exactas que lo respaldan; las propuestas cuya cita no está literalmente en el texto se descartan, y todo va a la cola de revisión, nunca directo. Sin modelo cargado la respuesta es `no_model`.
- **Del asistente.** `commitment_add` anota uno dicho en un chat. Un día solo se guarda si es un día real o las palabras nombran exactamente uno («el martes», «en dos semanas», «15 de octubre»); si no, las palabras quedan como `due_text`: no se adivina nada.
- **Eventos.** `people.commitment.added {title, due, ref, person, …}` solo se envía para un compromiso tuyo (`i_owe`) que tiene día (cuando un compromiso pasa a serlo después, por añadirle un día o corregir el sentido, se envía entonces): la regla del hub lo convierte en un plazo en la aplicación de papeles, con `ref = hoard://people/commitment/<id>` para volver. Cualquier otro compromiso nuevo (te lo deben a ti, o aún sin día) se anuncia como `people.commitment.noted` con los mismos datos de antes. `people.commitment.done` y `people.commitment.overdue` (una vez por compromiso; una fecha nueva merece un aviso nuevo) se envían como siempre.
- **Fusionar y borrar.** Al fusionar dos personas, sus compromisos pasan a la que se queda; al borrar una persona, sus compromisos se conservan con el nombre tal como estaba.

### Con el resto de la familia (por el hub)

Todo esto habla con el hub de Hoard Link y se queda quieto sin él; nunca se leen los archivos de otras aplicaciones.

- **Quién estuvo en una reunión.** `people_from_minutes {minutes_id}` pide a Funes el acta (`minutes_get`; con una Funes antigua y si se le pide escribirla, `scribe_minutes`), busca a cada asistente por nombre, alias o correo (varias coincidencias no se adivinan) y apunta *Reunión: <título>* el día de la reunión en la línea de tiempo de cada persona. No crea a nadie: los asistentes que no coinciden con nadie salen como `unmatched`, varias personas como `ambiguous`. Es idempotente por reunión y persona, también frente al camino de los compromisos de arriba (mismo título, mismo día, una vez), y enlaza a la persona con el acta en el grafo de referencias del hub (`hoard://people/person/<id>` con `hoard://funes/minutes/<id>`). La regla del hub para `funes.minutes.ready` la llama sola.
- **Último contacto por correo.** El hub lee el buzón una vez para toda la familia. People's Hoard registra un interés de correo cuyas `from_addresses` son los correos (alias de tipo correo) de las personas de la agenda (no archivadas, una por buzón, como máximo 300; se registra otra vez si el conjunto cambia, y un conjunto nuevo vuelve a leer el correo que el hub ya guardó), lee lo que llegó de ellas cada 30 minutos mientras funciona (y con `contacts_sync_mail` o **Leer ahora** en Ajustes) y, por persona, guarda la fecha, el canal *Correo* y el asunto como nota de una línea, como mucho una línea por persona y día. El correo pasa por el `famMailRouter` de la familia (solo hub: People no tiene ayudante de correo) y pide las cabeceras de lista y de categoría, así que un boletín o un correo de las pestañas Promociones/Social/Foros de Gmail desde la dirección de un contacto no cuenta como contacto; el cuerpo nunca se guarda y no se reclama ningún correo (no es de esta aplicación). Solo mientras el correo del hub está activo (`mailAvailable()`); el ajuste *Actualizar el último contacto con el correo* y `PEOPLE_MAIL_AUTO=0` lo apagan.
- **Ideas de regalo.** Por persona: una idea, una página opcional y un máximo opcional (`gift_idea_add`, `gift_ideas`, la sección *Ideas de regalo* de la ficha). `gift_watch {idea_id}` (o *Vigilar precio*) pide a Tantalus, por el hub, que la vigile (`watcher_add` con el texto, la página y el máximo de la idea, `source_ref = hoard://people/gift/<id>`) y guarda el id del vigilante; volver a pedirlo devuelve el mismo vigilante. `gift_days_before` días antes de un cumpleaños (ajuste, 21 por defecto) las ideas que quedan por regalar van al resumen diario como evento `digest.item`: «Cumpleaños de X en N días: ideas guardadas: …», una vez por persona y cumpleaños.
- **Agenda de la familia.** `GET /api/family/agenda` (con el token de la propia aplicación) responde con los cumpleaños (`birthday`, con la edad si se conoce el año), los seguimientos que tocan por la cadencia de cada persona, último contacto más los días que quería hablar (`followup`; el que ya venció se queda en el primer día de una ventana que incluya hoy) y los compromisos abiertos con día (`deadline`, en los dos sentidos; lo que yo debo es `high`). El manifiesto dice `"x-family": {"agenda": true}`.

Los cumpleaños se guardan como `AAAA-MM-DD` (año conocido) o `--MM-DD` (año desconocido); la ventana de próximos eventos y el cálculo de la edad tratan bien el cruce de diciembre a enero y el 29 de febrero en años no bisiestos.

## Conectar un asistente (MCP)

`server/mcp.js` es un servidor MCP por stdio que reenvía cada llamada a la aplicación en marcha, de modo que solo un proceso abre la base de datos. Mantened la aplicación abierta mientras el asistente trabaja.

```json
{
  "command": "node",
  "args": ["C:/ruta/a/peoples-hoard/server/mcp.js"],
  "env": { "PEOPLE_URL": "http://127.0.0.1:5182", "PEOPLE_TOKEN_FILE": "C:/ruta/a/peoples-hoard/data/mcp-token" }
}
```

`faustus-plugin.json` describe la aplicación para Faustus (comprobación de salud, arranque y comando MCP con marcadores).

Herramientas (27):

| Herramienta | Uso |
| --- | --- |
| `find_people` | Búsqueda difusa, sin acentos, por nombre parcial sobre personas, apodos y alias; devuelve candidatos puntuados. |
| `get_person` | Ficha completa: datos, últimos 10 contactos, recordatorios abiertos, compromisos abiertos en los dos sentidos, días desde el último contacto. |
| `prepare_person_chat` | Preparación breve y actualizada para hablar con alguien, con referencias a los registros y datos discrepantes señalados. |
| `upsert_person` | Crear o actualizar una persona por id o nombre exacto; todos los campos salvo el nombre son parciales. |
| `add_alias` | Añadir un identificador (WhatsApp, correo, teléfono u otro) para que futuros mensajes resuelvan a esa persona; idempotente. |
| `add_fact` | Guardar un dato libre de clave/valor («le gusta» / «el senderismo»); idempotente. |
| `log_interaction` | Registrar un contacto y actualizar cuándo hablasteis por última vez. |
| `add_reminder` | Crear un recordatorio, opcionalmente ligado a una persona. |
| `complete_reminder` | Marcar un recordatorio como hecho. |
| `upcoming` | Cumpleaños, recordatorios pendientes y personas abandonadas en N días, con un resumen en una línea. |
| `list_people` | Listar personas, opcionalmente filtradas por círculo. |
| `commitments_list` | Compromisos filtrados por persona, sentido, estado, vencidos y fecha. |
| `commitment_add` | Anotar una promesa: yo debo algo a alguien, o me lo deben. Palabras como «el viernes» pasan a fecha si nombran un único día. |
| `commitment_update` | Cambiar el texto, el día, la persona o el sentido de un compromiso. |
| `commitment_done` / `commitment_drop` | Marcar un compromiso como cumplido o como ya no aplicable. |
| `commitments_review` | Ver la cola de revisión o resolver una propuesta (aceptarla con una persona, o descartarla). Pregunta antes al usuario. |
| `commitments_ingest_minutes` | Pedir a Funes (por el hub) el acta de una reunión y anotar sus tareas (`replace` relee una reunión quitando lo que el usuario no ha tocado; `regenerate` reescribe el acta). Informa de `no_model`, `hub_down`, `tool_missing`, `unknown_session` o `funes_error` en vez de fallar. |
| `commitments_extract_text` | Proponer compromisos a partir de un texto pegado con el modelo local; van a la cola de revisión. |
| `commitments_digest` | Qué está vencido y qué vence pronto, con palabras: «le debes a X…», «X te debe…». |
| `people_from_minutes` | Apuntar *Reunión: <título>* en la línea de tiempo de cada asistente de un acta de Funes (no crea personas; informa de `unmatched` y `ambiguous`). Idempotente. |
| `contacts_sync_mail` | Leer ahora el correo del hub (solo remitentes y asuntos) y actualizar el último contacto de las personas con correo. |
| `gift_idea_add` / `gift_ideas` | Guardar una idea de regalo para una persona (página y máximo opcionales; la misma idea no se guarda dos veces) / listar las de una persona o de todas. |
| `gift_watch` | Pedir a Tantalus, por el hub, que vigile el precio de una idea de regalo. Informa de `hub_down`, `tool_missing`, `tantalus_unavailable` o `tantalus_error`. |
| `find_duplicate_people` | Parejas de personas que probablemente son la misma (nombres parecidos, el mismo correo o teléfono escrito de otra forma, el mismo cumpleaños) con puntuación, motivos y cuál conservar; solo lectura, `GET /api/people/duplicates` es lo mismo. |
| `merge_people` | Fusionar un duplicado en otra persona; los compromisos también pasan (destructiva). |
| `delete_person` | Borrar una persona y todo lo que tiene enlazado; los compromisos se conservan con el nombre tal como estaba (destructiva). |

Cada descripción termina con una línea `Sinónimos:` con las palabras que se usan en español. Los nombres ambiguos devuelven `candidates` para que el asistente pregunte en vez de adivinar: dos personas pueden compartir nombre de pila.

## Datos y límites

- `data/peoples-hoard.db` — SQLite en modo WAL; migraciones en `server/db.js` (tabla `schema_version`); un índice FTS5 mantenido a mano (`people_fts`) sobre nombre, apodo, alias, resumen, notas y datos, con plegado de acentos cuando la versión de SQLite lo permite.
- `data/mcp-token` — 32 bytes aleatorios escritos en cada arranque; nunca se sube al repositorio.
- La búsqueda combina una pasada por subcadena con plegado de acentos (encuentra coincidencias parciales en mitad de una palabra) con una pasada FTS5 por prefijo para ampliar el alcance sobre notas y datos.
- Solo se aceptan peticiones desde `localhost` / `127.0.0.1`; las peticiones de otras webs se rechazan.
- El par tipo + valor de un alias es único en toda la agenda: un nombre de WhatsApp, un correo o un teléfono solo puede resolver a una persona.
- Las únicas llamadas de red son al hub local de Hoard Link (eventos, el proxy hacia las actas de Funes, el correo, Tantalus y el modelo local); cuando no está, la aplicación funciona como antes y lo dice donde importa.

## Verificación

```sh
npm test        # node --test tests/*.test.js — fechas/plegado, lógica de dominio, API HTTP, autenticación y herramientas, compromisos (con un hub de pega)
npm run build   # vite build → dist/
```

Las pruebas usan carpetas temporales y nunca tocan `data/`.

Licencia: MIT (ver `LICENSE`).

## Con las piezas comunes de la familia (Hoard Link 0.8)

`server/hoard-link.js` y `server/hoard-commons/` son copias vendidas de las piezas comunes; no se editan. People las usa para las fechas dichas en voz alta (`parseDue`: «el martes», «en dos semanas», «fin de mes», «3 nov»; las vagas como «la semana que viene» se quedan en `due_text`), la exportación `.ics` (`buildIcs`: los cumpleaños se repiten cada año y mantienen sus UID), el plegado de acentos, `addDays` / `daysBetween`, la normalización de los datos de contacto (un alias conserva el valor tal como se escribió y una clave de comparación `aliases.norm`: `Ana+news@Example.com` y `ana@example.com`, o `600 11 22 33` y `+34 600112233`, son el mismo dato, y un dato sigue siendo de una sola persona; las filas anteriores a la clave se rellenan la primera vez que se miran), el buscador de duplicados (`nameSimilarity`), el enrutador de correo del último contacto, el guardia, las rutas del agente (un solo formato de error JSON `{ error, code?, issues?, candidates? }`), el puente MCP, el servidor de la SPA, el envoltorio de SQLite (`BEGIN IMMEDIATE`, puntos de guardado, espera por bloqueo, punto de control del WAL al salir), los temporizadores y los ayudantes de puerto y token. El token MCP (`<datos>/mcp-token`) se crea una vez y se conserva entre reinicios; SIGINT / SIGTERM paran las pasadas de fondo y cierran la base de datos.
