---
name: People's Hoard
description: Una agenda personal cálida y directa para recordar quién es cada persona y cuándo tocó hablar.
colors:
  accent: "#d6905f"
  accent-hover: "#dea77f"
  accent-ink: "#1b1613"
  ink: "#ece6e1"
  muted: "#beb8b4"
  paper: "#1c1814"
  white: "#241f1b"
  sunken: "#161310"
  line: "#433b35"
  border-hover: "#6a5f58"
  soft: "#2f2925"
  sidebar: "#241f1b"
  nav-active: "#2f2925"
  nav-active-ink: "#ece6e1"
  nav-hover: "#2f2925"
  field-line: "#433b35"
  field-ink: "#ece6e1"
  placeholder: "#a6a09b"
  supporting-ink: "#beb8b4"
  focus: "#d6905f"
  button-line: "#433b35"
  panel: "#241f1b"
  circle-bg: "rgba(214, 144, 95, 0.14)"
  circle-ink: "#d6905f"
  warn-bg: "color-mix(in srgb, var(--hoard-warning) 16%, transparent)"
  warn-ink: "color-mix(in srgb, var(--hoard-warning) 70%, white)"
  danger-bg: "color-mix(in srgb, var(--hoard-danger) 16%, transparent)"
  danger-ink: "color-mix(in srgb, var(--hoard-danger) 55%, white)"
  danger-line: "color-mix(in srgb, var(--hoard-danger) 40%, transparent)"
  ok-bg: "color-mix(in srgb, var(--hoard-success) 16%, transparent)"
  ok-ink: "color-mix(in srgb, var(--hoard-success) 68%, white)"
typography:
  headline:
    fontFamily: "Cinzel, Iowan Old Style, Charter, Georgia, Liberation Serif, Noto Serif, Times New Roman, serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0"
  title:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.65
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  button:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontFamily: "Source Sans 3, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Liberation Sans, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.8
rounded:
  badge: "6px"
  field: "8px"
  control: "8px"
  card: "10px"
  panel: "10px"
  dialog: "10px"
spacing:
  control-gap: "8px"
  action-gap: "10px"
  section-gap: "16px"
  panel-padding: "20px"
  page-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.control}"
  field:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.field-ink}"
    rounded: "{rounded.field}"
    padding: "8px 11px"
    width: "100%"
  nav-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.supporting-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  chip-circle:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.supporting-ink}"
    rounded: "{rounded.badge}"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: People's Hoard

## Overview

**Creative North Star: "Agenda de bolsillo"**

Una agenda personal de carbón cálido, paneles marrones y acento terracota luminoso para las acciones. La interfaz está en español de España; las fechas combinan expresiones relativas y fechas locales legibles según el contexto.

La dirección estética vigente se hereda del tema Hoard: títulos de página y marca serif, texto y formularios sans, capas oscuras planas y bordes discretos. Los nombres históricos `paper` y `white` son alias de superficies oscuras; la antigua descripción de papel claro ha quedado sustituida por los tokens actuales.

Alcance de esta actualización (tarea 1303): Historial de contactos en `/#/personas`, contrastado con `client/src/index.css`, su importación de `hoard-theme.css`, `client/index.html` (`data-hoard-app="people"`), `InteractionHistory.jsx`, `ui.jsx` y las capturas existentes de la entrega congelada `44aa0518dfd5ff2cd2ca84ae6431f36d5cd5c31c`. `index.css` mapea los alias y sus reglas finales sin capa prevalecen sobre las clases iniciales y las utilidades. Las cuatro capturas de `D:/LocalAI/research-inbox/people-history-export23/` cubren escritorio (1280×900), móvil desde arriba (390×900) y los estados de resultado/error en viewports inferiores (390×900); estos últimos no son capturas de página completa. Esta actualización no añade capturas ni detector. Las primitivas compartidas se extraen de esa cascada; las descripciones conservadas de otras superficies son contexto de código y documentación previa, sin certificación visual global ni nativa.

**Key Characteristics:**

- Tarjetas de persona en rejilla, no filas de tabla: esto es gente, no líneas de un extracto.
- Círculos ("familia", "amigos", "trabajo") como chips neutros, reutilizados como filtro y como etiqueta.
- El tiempo se lee siempre en palabras: "hace 12 días", "en 3 días", "hoy", nunca solo una fecha ISO.
- Cada escritura es inmediata: el resumen y las notas se guardan al salir del campo; los datos, alias, contactos y recordatorios se añaden con formularios pequeños en línea.

## Colors

El terracota luminoso organiza las acciones; carbón, marrón y tinta clara sostienen la lectura de fichas y listas.

### Primary

- **Terracota luminoso:** `accent` en botones primarios, acciones de texto, el punto de la línea de tiempo y el foco de escritura. `accent-hover` lo aclara al pasar el puntero; `accent-ink` da tinta oscura al botón primario.
- **Marrón de selección:** `nav-active` / `nav-active-ink` marcan la página activa; `soft` es el hover de filas y el fondo de chips neutros.

### Neutral

- **Carbón y marrón:** `paper` es el fondo profundo; `white`, `panel` y `sidebar` son la superficie marrón; `sunken` es el fondo más oscuro de los campos.
- **Tinta clara:** `ink` para nombres y títulos; `muted` para descripciones; `supporting-ink` para ayudas, fechas y cabeceras; `placeholder` para ejemplos de campo.
- **Líneas:** `line` separa filas y tarjetas; `field-line` y `button-line` bordean controles; `border-hover` refuerza paneles al pasar el puntero.

### Semantic

- **Círculo:** `circle-bg` / `circle-ink` siguen definidos como alias del acento. En la cascada actual, la regla final del chip prevalece sobre su variante de círculo: el fondo efectivo es `soft` y la tinta `supporting-ink`. El nombre del círculo aporta la identidad.
- **Cumpleaños próximo:** chip `warn-bg` / `warn-ink` con el icono 🎂 y los días restantes; aparece en la tarjeta de Personas y en Agenda.
- **Abandonado:** el texto ya lo dice ("hace 45 días"); no hay un rojo permanente sobre una persona, solo sobre la acción de borrar.
- **Peligro:** `danger-bg` / `danger-ink` reservado a borrar y a alias en conflicto.

**The Nunca solo color Rule.** Cada estado temporal (cumpleaños cerca, abandonado, recordatorio vencido) se lee en el texto ("hace 12 días", "en 3 días"); el color es refuerzo, no el único portador de la información.

## Typography

**Display Font:** la pila serif de Hoard encabezada por Cinzel, con Iowan Old Style, Charter, Georgia y otros respaldos, para el título principal y la marca. La pila declarada no acredita que Cinzel esté instalada o descargada.

**Body Font:** la pila sans de Hoard encabezada por Source Sans 3 y respaldada por fuentes del sistema, para texto, formularios y títulos de sección. Consolas para rutas y variables en Ajustes, según la documentación conservada.

- **Headline:** título de página serif (30px, peso 700, interlineado 1,25); la regla final `main h1` mantiene ese tamaño también en móvil, por encima de la utilidad inicial de 26px.
- **Title:** título de sección sans (17px, peso 600); «Historial de contactos» conserva esta jerarquía.
- **Body:** 14px; descripciones y listas 13px; ayudas y fechas 12px; chips 10px.
- **Label:** etiqueta visible encima de cada campo (12px, seminegrita). Los placeholders muestran ejemplos ("1990-03-14 o --03-14"), nunca sustituyen a la etiqueta.

## Layout

Escritorio: rejilla `224px | 1fr`; índice pegado arriba a `100dvh`; contenido centrado con máximo `1200px` y márgenes `32px`.

- **Personas:** buscador, chips de círculo, rejilla de tarjetas (`2` columnas en tablet, `3` en escritorio).
- **Historial de contactos (extensión verificada):** panel antes de las tarjetas; filtros en una columna, dos desde `640px` y tres desde `1024px`, con separación de `12px`. Contador, formato y descarga preceden a las filas. Formato y botón se redistribuyen por ajuste de línea; ayudas, preparación, éxito y error siguen en el flujo. En `390px` los campos se apilan y los resúmenes conservan saltos y parten palabras; las capturas e informe de raíz no muestran desbordamiento horizontal en los dos tamaños probados.
- **Persona:** cabecera con nombre/apodo/círculos/cumpleaños/ubicación (editable como formulario completo, no campo a campo); resumen y notas en dos columnas; datos y alias en dos columnas; línea de tiempo y recordatorios en dos columnas.
- **Agenda:** tres columnas (cumpleaños, recordatorios, abandonados) que se apilan en móvil.
- **Compromisos:** «Por revisar» arriba (solo si hay propuestas), después la lista con filtros en una fila que se parte en móvil, y abajo dos paneles (anotar uno / traer desde una reunión o un texto). La ficha de persona lleva una sección «Compromisos» con dos columnas, «Le debo» y «Me debe».
- **Ajustes:** dos paneles, copia de seguridad e instalación.

Por debajo de `768px` el índice pasa a barra superior desplazable. La página usa margen lateral de `16px`, que sube a `32px` desde `640px`; las rejillas usan sus propios puntos de cambio. Las descripciones de Persona, Agenda, Compromisos y Ajustes se conservan como contexto de código/documentación previa y no fueron verificadas visualmente en esta tarea.

## Elevation & Depth

Plano por defecto: paneles y tarjetas usan capas tonales y borde; la regla final elimina la sombra del hover y refuerza el borde. El tema compartido reserva la sombra (`0 8px 28px rgba(0, 0, 0, 0.38)`) a diálogos y avisos flotantes, con velo negro al 60% en el diálogo. Estos dos componentes son extracción del código, no estados recapturados para esta entrega.

**The Profundidad funcional Rule.** Una sombra en reposo significa "esto flota sobre la página"; en People's Hoard nada flota salvo diálogos y avisos.

## Shapes

Campos, botones y navegación (`8px`), tarjetas, paneles y diálogo (`10px`), chips (`6px`). La línea de tiempo usa un punto de `8px` en `accent` y una línea vertical de `1px` en `line` entre entradas consecutivas. Los iconos de navegación son trazos SVG de 1,8px; la marca raster existente se conserva. Historial no añade assets.

## Components

### Buttons

Primario terracota con tinta oscura, secundario transparente con borde y texto claro, destructivo transparente con tinta de peligro y fondo semántico al pasar el puntero. Altura mínima efectiva (`36px`) también en la variante pequeña, cuya altura inicial queda sobrescrita por la regla final; conserva su padding compacto. Deshabilitado a opacidad 0,45. Transición de fondo y color (`0,16s`), anulada con movimiento reducido. Las acciones de texto se subrayan al pasar el puntero.

### Inputs / Fields

Fondo hundido, borde discreto y texto claro, con etiquetas visibles encima. El foco cambia el borde al acento; la regla final de campo elimina el contorno del control enfocado. Botones y enlaces mantienen el contorno visible del tema. Esta descripción registra la cascada existente, sin certificar globalmente accesibilidad o contraste.

### Historial exportable

El selector «Formato del historial» ofrece JSON y CSV (UTF-8), junto al secundario «Descargar historial». La ayuda explica que incluye todas las coincidencias actuales de todas las páginas y que se prepara al pulsar. Durante la petición el botón indica «Preparando archivo…», queda deshabilitado y un estado textual anuncia la preparación completa. El éxito dice «Archivo preparado para descargar.»: no afirma que el usuario lo haya guardado. El error usa una alerta en el flujo y explica que conserva los filtros y permite reintentar con el mismo botón. Cambiar filtros, formato o consulta, cerrar o desmontar el panel invalida la petición pendiente. Lectura, enlaces a personas y paginación permanecen disponibles según su estado original; exportar no es una copia de seguridad completa. La verificación funcional pertenece a ROOT-REVIEW.md y PEER-REVIEW.md; esta corrección documental no repite sus pruebas.

### Person cards

Nombre y apodo, chips de círculo, chip de cumpleaños próximo si cae dentro de 14 días, y "Último contacto hace N días" en gris de apoyo. Toda la tarjeta es un enlace a la ficha; el hover refuerza el borde sin sombra ni desplazamiento.

### Person page

Cabecera con acciones (Editar datos, Fusionar, Archivar, Borrar) siempre visibles; "Editar datos" sustituye la cabecera por un formulario completo con "Guardar datos" / "Cancelar", igual que el resto de la familia Hoard. Resumen y notas son textareas que guardan solas al perder el foco. Datos (hechos) y alias son listas editables con un formulario de una fila para añadir. La línea de tiempo antepone el formulario "He hablado hoy" a la lista, más reciente primero. Los recordatorios completados se pliegan bajo un `<details>` para no ensuciar la vista.

### Circle chips

Chip redondeado tipo filtro (`circle-filter`), con el nombre del círculo y su recuento en cifra tabular. El filtro activo usa `nav-active` / `nav-active-ink`, igual que la navegación, para que quede claro que es una selección, no una etiqueta informativa.

### Agenda

Tres paneles iguales. Cumpleaños ordena por días restantes y muestra la edad si se conoce el año. Recordatorios muestra la fecha, el texto y, si está ligado a una persona, un enlace a su ficha, con un botón "Hecho" que completa sin salir de la página. Abandonados muestra "hace N días" y la cadencia deseada, con un botón "He hablado hoy" que registra un contacto rápido al instante.

### Compromisos

Cada compromiso es una fila con casilla «cumplido», el texto, una etiqueta de sentido (`chip-warn` para «Yo debo», `chip-circle` para «Me deben»), la persona como enlace, la fecha en palabras («venció hace 4 días», «para mañana», «el viernes» si solo hay palabras; `chip-danger` si está vencido) y el origen (Reunión, Chat, Texto, Manual) con la cita literal desplegable. Las acciones (cambiar fecha, descartar, borrar) son enlaces de texto a la derecha y pasan bajo el texto en móvil. Las propuestas por revisar muestran el motivo en una línea, la cita y una fila de botones que resuelven al instante: un botón por candidato, «Crear a …», «Otra persona…», «Sin persona» y «Descartar»; si no se sabe quién debe, hay que elegirlo antes de aceptar. La insignia de la navegación suma vencidos y propuestas.

### Feedback

Aviso centrado abajo (`role=status` o `alert`) con botón "Cerrar" y cierre automático a los 4 s. Borrados con `<dialog>` nativo y botón destructivo, siempre nombrando qué se pierde (alias, datos, línea de tiempo, recordatorios).

## Do's and Don'ts

### Do:

- **Do** escribir el tiempo en palabras ("hace 12 días", "en 3 días") además de la fecha exacta cuando haga falta.
- **Do** dejar que el resumen y las notas se guarden solos; usar formularios solo para altas (persona, dato, alias, contacto, recordatorio).
- **Do** mostrar el círculo como chip reutilizado igual en la tarjeta, la ficha y el filtro.
- **Do** confirmar siempre antes de borrar o fusionar personas: son acciones irreversibles.

### Don't:

- **Don't** añadir un segundo color de acento ni usar avatares o fotos generadas.
- **Don't** convertir la agenda en una tabla de filas: las personas son tarjetas.
- **Don't** mostrar un cumpleaños o un contacto reciente solo con color: el texto siempre lo dice.
- **Don't** dejar que "Editar datos" edite campo a campo; es un formulario completo con guardar/cancelar explícitos.
