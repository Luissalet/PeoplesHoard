# Exportar el historial registrado

En **Personas → Consultar historial**, aplica los filtros y elige JSON o CSV junto al contador. **Descargar historial** incluye todas las coincidencias actuales, aunque la pantalla sólo muestre una página. El archivo refleja la consulta al pulsar descargar; puede cambiar si otra sesión registra o edita contactos entre la búsqueda y la descarga.

Los filtros de texto, persona, canal, fechas inclusivas y personas archivadas tienen el mismo significado que la búsqueda. Cambiar filtros, formato o cerrar el historial invalida una descarga pendiente. Si falla, los filtros se conservan para reintentar. No se leen cuerpos de mensajes ni servicios externos.

- JSON conserva `null`, booleanos y las filas completas, con `count`, `filters` y `exported_at` en la cabecera.
- CSV UTF-8 incluye BOM, nombres de columna y todas las celdas entre comillas, con comillas interiores duplicadas y filas CRLF. Los saltos de línea de los resúmenes se conservan dentro de su celda; `null` se representa como celda vacía. Se guardan los textos originales: importar como texto en una hoja de cálculo evita interpretar contenidos como fórmulas.

API: `POST /api/interactions/export`, cuerpo con los filtros de búsqueda y `format: "json" | "csv"`. Devuelve el archivo como adjunto; `limit` y `offset` se rechazan para evitar exportaciones parciales accidentales. MCP: `export_interactions` devuelve `text`, `filename`, `media_type`, `count`, `filters`, `exported_at` y `format`. Este único tool evita el límite habitual de20KB; el resto mantiene sus límites. No se crean archivos persistentes en el servidor ni se modifican los registros. La exportación completa se prepara en memoria.

El escapado de CSV sigue las reglas de campos citados de [RFC4180](https://www.rfc-editor.org/rfc/rfc4180); el archivo usa UTF-8 explícito. Esto no sustituye a la copia de seguridad completa de Ajustes.
