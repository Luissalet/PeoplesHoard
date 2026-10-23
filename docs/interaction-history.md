# Historial de contactos

En Personas, **Consultar historial** abre una consulta independiente de la
búsqueda de nombres y círculos. Permite recuperar conversaciones antiguas sin
ir abriendo fichas o depender de los diez contactos recientes de `get_person`.
Cada resultado conserva la persona, el resumen, la fecha/hora, el canal y la
procedencia guardados. El enlace abre su ficha. No genera nuevos resúmenes.

Texto exige todas las palabras, sin distinguir mayúsculas ni acentos, dentro
del resumen, el nombre o el apodo actuales de la persona. No busca alias ni
cuerpos de mensajes. Las personas archivadas se excluyen inicialmente; su
inclusión es explícita. Los resultados se ordenan por instante descendente e
identificador descendente para desempatar, con paginación de25,50o100filas y
total exacto. Cambiar filtros retira el resultado anterior; error y actualización
del copilot conservan los campos. La consulta no modifica registros.

## Fechas y API/MCP

Los campos Desde/Hasta representan días completos en la zona que muestra el
navegador. Se convierten a instantes ISO antes de la petición; un día con cambio
horario puede tener23o25horas. Los resultados muestran las fechas en esa zona.

`GET /api/interactions` y `search_interactions` comparten estos parámetros:

- `q`: texto de hasta200caracteres, opcional.
- `person_id`: identificador exacto, opcional.
- `channel`: whatsapp, email, call, meet, message u other, opcional.
- `from`, `to`: instantes ISO con Z o desfase explícito; ambos extremos incluidos.
  No se aceptan fechas sin hora ni horas sin zona en la API/MCP.
- `include_archived`: booleano, inicialmente false.
- `limit`:1–100, inicialmente25; `offset`:0o mayor.

HTTP representa booleanos como true/false y límites como números de consulta;
MCP recibe sus tipos nativos. La respuesta incluye `interactions`, `total`,
`filters`, `offset`, `limit` y `has_more`. Los instantes se comparan como fechas
SQLite, incluidos registros históricos con desfases diferentes. La paginación
no es una instantánea inmutable: una nueva interacción puede mover resultados
entre consultas. No se crea otra tabla, historial o servicio de mensajes.

La investigación de [Monica](https://github.com/monicahq/monica), sus actividades
y diario, orientó la necesidad de consultar el historial más allá de cada
contacto. El motor es propio y no incorpora código de ese proyecto ni afirma
paridad con él. No requiere modelos, correo, procesos en segundo plano ni
servicios externos.
