# People's Hoard: ficha para Faustus

## Qué añade esta versión
- `commitments_import_talos` (REST `POST /api/commitments/import-talos`): importa a los compromisos de People los compromisos firmes que Talos extrae de una reunión transcrita.

## Qué puede hacer
- Aceptar solo elementos `kind: commitment` con `firm: true`.
- Rechazar con motivo (`proposal`, `not_commitment`, `not_firm`, `no_text`, `no_source_ref`, `invalid`) propuestas, preguntas, decisiones y requisitos.
- Conservar fuente (`funes`), cita, instante en la reunión y referencia `talos:<sesión>#<elemento>`.
- No duplicar: la clave `talos:<ref>` evita un segundo compromiso al reimportar, también tras completarlo, descartarlo o resolver su revisión.
- Mandar a la cola de revisión los responsables o personas dudosos, igual que con las actas.

## Qué no puede hacer
- No lee Talos por su cuenta: quien llama (Faustus) pasa la salida de `scribe_requirements` con `format: commitments`.
- No crea personas ni infiere compromisos de propuestas.

## Pruebas
- `node --test tests/*.test.js` (`tests/talos-import.test.js` cubre propuestas, importación única, deduplicación, REST y herramienta).

## Pendientes
- Ninguno abierto.
