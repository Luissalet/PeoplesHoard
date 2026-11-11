# People's Hoard: ficha para Faustus

CRM personal local (puerto 5182, id `people`): quién es cada persona, qué sabes de ella, cuándo hablasteis, compromisos en los dos sentidos y qué recordar. 38 herramientas MCP.

## Qué puede hacer
- Compromisos: `i_owe` / `owed_to_me`, con fecha, estado, origen (Funes, Talos, WhatsApp, texto, chat, manual), cola de revisión, balance «Qué debo / Qué me deben» y vencidos.
- Avisos al resumen diario del hub (`digest.item`, una vez cada uno): compromisos que vencen hoy o vencidos, recordatorios de hoy, cumpleaños y fechas señaladas (una semana antes y el día), relaciones que se enfrían. `people_nudges` dice qué hay y si ya salió.
- `prepare_to_meet`: preparación escrita antes de ver a alguien con el modelo de la familia (por el hub); sin modelo devuelve la lista de datos.
- Fechas señaladas por persona (`person_date_add` / `person_date_remove`), en agenda, `.ics`, agenda de la familia y resumen.
- `import_people_vcard`: importa un `.vcf` con vista previa (`apply: false`); une por UID, correo, teléfono o nombre exacto y solo completa lo vacío.
- Último contacto automático: por correo del hub y por las tandas de WhatsApp que Faustus pasa a `commitments_from_messages`.
- Duplicados (`find_duplicate_people`), fusión que conserva lo que solo sabía el duplicado, exportación vCard, historial completo de contactos.

## Qué no puede hacer
- No lee WhatsApp ni los chats de Faustus por su cuenta: solo lo que Faustus envía. Hoard Link no ofrece leer mensajes de Faustus.
- No crea personas desde actas ni mensajes; no relaciona personas entre sí (pareja de, hermano de…).

## Pruebas
- `node --test tests/*.test.js` (190; incluye cliente MCP real para JSON y CSV de 137 contactos registrados, por encima del límite normal; `tests/crm-autopilot.test.js` cubre fechas, enfriamiento, avisos con hub de pega, prepárame, WhatsApp, vCard y fusión).

## Skills

El puente MCP entrega las skills copiadas junto a los datos mediante `skills_list`, `skill_read`, instrucciones de conexión y prompts `skill-<slug>`. La copia completa de Node commons se sincroniza desde el Hub. `export_interactions` conserva todos los registros en JSON y CSV por HTTP y MCP; las búsquedas normales mantienen su límite y paginación.
