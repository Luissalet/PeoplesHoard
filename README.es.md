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
| `PEOPLE_URL` | Puente MCP: URL de la aplicación (por defecto `http://127.0.0.1:5182`). Debe ser local. |
| `PEOPLE_TOKEN_FILE` / `PEOPLE_TOKEN` | Puente MCP: de dónde leer el token (por defecto `<datos>/mcp-token`). |

## Qué hace

- **Personas** — búsqueda instantánea (sin distinguir acentos, encuentra nombres parciales en cualquier parte de la palabra, también por apodo y alias), chips de círculo como filtro, tarjetas con nombre, círculos, «hace 12 días» del último contacto y una insignia de cumpleaños próximo, y un formulario rápido de alta.
- **Ficha de persona** — cabecera (nombre, apodo, círculos, cumpleaños, ubicación, cadencia de contacto deseada) editable como un único formulario; resumen y notas en textareas que se guardan al salir del campo; datos como lista de clave/valor editable («le gusta» / «el senderismo»); línea de tiempo de contactos con un formulario de una línea («he hablado hoy»); recordatorios con fecha y una casilla «hecho»; editor de alias (WhatsApp, correo, teléfono, otro identificador); archivar, fusionar con un duplicado y borrar.
- **Agenda** — próximos cumpleaños con la edad cuando se conoce el año, recordatorios pendientes y una lista de «abandonados»: personas con las que no habláis dentro de la cadencia deseada, con un botón «he hablado hoy» que apunta un contacto rápido al instante.
- **Ajustes** — carpeta de datos y versión, exportación/importación JSON para copias de seguridad.

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

Herramientas (12):

| Herramienta | Uso |
| --- | --- |
| `find_people` | Búsqueda difusa, sin acentos, por nombre parcial sobre personas, apodos y alias; devuelve candidatos puntuados. |
| `get_person` | Ficha completa: datos, últimos 10 contactos, recordatorios abiertos, días desde el último contacto. |
| `upsert_person` | Crear o actualizar una persona por id o nombre exacto; todos los campos salvo el nombre son parciales. |
| `add_alias` | Añadir un identificador (WhatsApp, correo, teléfono u otro) para que futuros mensajes resuelvan a esa persona; idempotente. |
| `add_fact` | Guardar un dato libre de clave/valor («le gusta» / «el senderismo»); idempotente. |
| `log_interaction` | Registrar un contacto y actualizar cuándo hablasteis por última vez. |
| `add_reminder` | Crear un recordatorio, opcionalmente ligado a una persona. |
| `complete_reminder` | Marcar un recordatorio como hecho. |
| `upcoming` | Cumpleaños, recordatorios pendientes y personas abandonadas en N días, con un resumen en una línea. |
| `list_people` | Listar personas, opcionalmente filtradas por círculo. |
| `merge_people` | Fusionar un duplicado en otra persona (destructiva). |
| `delete_person` | Borrar una persona y todo lo que tiene enlazado (destructiva). |

Cada descripción termina con una línea `Sinónimos:` con las palabras que se usan en español. Los nombres ambiguos devuelven `candidates` para que el asistente pregunte en vez de adivinar: dos personas pueden compartir nombre de pila.

## Datos y límites

- `data/peoples-hoard.db` — SQLite en modo WAL; migraciones en `server/db.js` (tabla `schema_version`); un índice FTS5 mantenido a mano (`people_fts`) sobre nombre, apodo, alias, resumen, notas y datos, con plegado de acentos cuando la versión de SQLite lo permite.
- `data/mcp-token` — 32 bytes aleatorios escritos en cada arranque; nunca se sube al repositorio.
- La búsqueda combina una pasada por subcadena con plegado de acentos (encuentra coincidencias parciales en mitad de una palabra) con una pasada FTS5 por prefijo para ampliar el alcance sobre notas y datos.
- Solo se aceptan peticiones desde `localhost` / `127.0.0.1`; las peticiones de otras webs se rechazan.
- El par tipo + valor de un alias es único en toda la agenda: un nombre de WhatsApp, un correo o un teléfono solo puede resolver a una persona.
- El servidor no hace ninguna llamada a internet.

## Verificación

```sh
npm test        # node --test tests/*.test.js — fechas/plegado, lógica de dominio, API HTTP, autenticación y herramientas
npm run build   # vite build → dist/
```

Las pruebas usan carpetas temporales y nunca tocan `data/`.

Licencia: MIT (ver `LICENSE`).
