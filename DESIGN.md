---
name: People's Hoard
description: Una agenda personal cálida y directa para recordar quién es cada persona y cuándo tocó hablar.
colors:
  accent: "#9a4f2b"
  accent-hover: "#7c3e20"
  ink: "#33241c"
  muted: "#71605a"
  paper: "#fbf7f3"
  white: "#ffffff"
  line: "#ecdcd0"
  soft: "#f5ebe2"
  sidebar: "#f6ede4"
  nav-active: "#ecd2ba"
  nav-active-ink: "#6b3115"
  nav-hover: "#f1e3d6"
  field-line: "#ddc7b6"
  field-ink: "#3d291f"
  placeholder: "#8a7368"
  supporting-ink: "#6c584c"
  focus: "#b1602f"
  button-line: "#e0cfc1"
  panel: "#f7efe8"
  circle-bg: "#f0e0d1"
  circle-ink: "#6b4526"
  warn-bg: "#f8ecd2"
  warn-ink: "#7a5a17"
  danger-bg: "#fbeceb"
  danger-ink: "#8a3a2c"
  danger-line: "#e8c8c2"
  ok-bg: "#e6efe3"
  ok-ink: "#2f5f3a"
typography:
  headline:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.65
  button:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: "18px"
  label:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  code:
    fontFamily: "Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.8
rounded:
  badge: "5px"
  field: "6px"
  control: "7px"
  card: "10px"
  panel: "8px"
  dialog: "12px"
spacing:
  control-gap: "8px"
  action-gap: "10px"
  section-gap: "16px"
  panel-padding: "20px"
  page-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    borderColor: "{colors.button-line}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "8px 15px"
  button-danger:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger-ink}"
    borderColor: "{colors.danger-line}"
    rounded: "{rounded.control}"
  field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.field-ink}"
    borderColor: "{colors.field-line}"
    rounded: "{rounded.field}"
    padding: "8px 11px"
    width: "100%"
  nav-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.nav-active-ink}"
    rounded: "{rounded.control}"
    padding: "10px 13px"
  chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.supporting-ink}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  chip-circle:
    backgroundColor: "{colors.circle-bg}"
    textColor: "{colors.circle-ink}"
    rounded: "{rounded.badge}"
  card:
    backgroundColor: "{colors.white}"
    borderColor: "{colors.line}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: People's Hoard

## Overview

**Creative North Star: "Agenda de bolsillo"**

Una libreta de contactos cálida, no una CRM corporativa: papel terracota, fichas de persona con cariño (nombre, apodo, círculos, cuándo tocó hablar) y una única tinta de acento terracota para las acciones. La interfaz está en español de España; las fechas y los "hace X días" se escriben como los diría una persona, nunca como una marca de tiempo cruda.

La dirección estética se hereda de la familia Hoard (papel, paneles de 8px, Segoe UI) y cambia el acento verde bosque o ámbar de sus hermanas por un terracota (`#9a4f2b`), que sobre papel mantiene contraste suficiente para texto y para botones.

**Key Characteristics:**

- Tarjetas de persona en rejilla, no filas de tabla: esto es gente, no líneas de un extracto.
- Círculos ("familia", "amigos", "trabajo") como chips de color propio, reutilizados como filtro y como etiqueta.
- El tiempo se lee siempre en palabras: "hace 12 días", "en 3 días", "hoy", nunca solo una fecha ISO.
- Cada escritura es inmediata: el resumen y las notas se guardan al salir del campo; los datos, alias, contactos y recordatorios se añaden con formularios pequeños en línea.

## Colors

El terracota organiza las acciones; los neutros de papel y arena sostienen la lectura de fichas y listas.

### Primary

- **Terracota:** `accent` en botones primarios, enlaces, el punto de la línea de tiempo y el foco de escritura. `accent-hover` lo oscurece al pasar el puntero.
- **Arena de selección:** `nav-active` / `nav-active-ink` marcan la página activa; `soft` es el hover de filas y el fondo de chips neutros.

### Neutral

- **Papel:** `paper` es la página; `white` las tarjetas, paneles de contenido y campos; `panel` los formularios de alta; `sidebar` el índice.
- **Tinta:** `ink` para nombres y títulos; `muted` para descripciones; `supporting-ink` para ayudas, fechas y cabeceras.
- **Líneas:** `line` separa filas y tarjetas; `field-line` y `button-line` bordean controles.

### Semantic

- **Círculo:** `circle-bg` / `circle-ink` para los chips de "familia", "amigos", "trabajo"... Un tono único y neutro: el color identifica "esto es un círculo", no un círculo concreto.
- **Cumpleaños próximo:** chip `warn-bg` / `warn-ink` con el icono 🎂 y los días restantes; aparece en la tarjeta de Personas y en Agenda.
- **Abandonado:** el texto ya lo dice ("hace 45 días"); no hay un rojo permanente sobre una persona, solo sobre la acción de borrar.
- **Peligro:** `danger-bg` / `danger-ink` reservado a borrar y a alias en conflicto.

**The Nunca solo color Rule.** Cada estado temporal (cumpleaños cerca, abandonado, recordatorio vencido) se lee en el texto ("hace 12 días", "en 3 días"); el color es refuerzo, no el único portador de la información.

## Typography

**Body Font:** Segoe UI con `system-ui` y `sans-serif` de respaldo; Georgia solo en la marca «P»; Consolas para rutas y variables en Ajustes.

- **Headline:** título de página (30px; 26px en móvil).
- **Title:** título de sección/tarjeta grande (17px).
- **Body:** 14px; descripciones y listas 13px; ayudas y fechas 12px; chips 10px.
- **Label:** etiqueta visible encima de cada campo (12px, seminegrita). Los placeholders muestran ejemplos ("1990-03-14 o --03-14"), nunca sustituyen a la etiqueta.

## Layout

Escritorio: rejilla `224px | 1fr`; índice pegado arriba a `100dvh`; contenido centrado con máximo `1200px` y márgenes `32px`.

- **Personas:** buscador, chips de círculo, rejilla de tarjetas (`2` columnas en tablet, `3` en escritorio).
- **Persona:** cabecera con nombre/apodo/círculos/cumpleaños/ubicación (editable como formulario completo, no campo a campo); resumen y notas en dos columnas; datos y alias en dos columnas; línea de tiempo y recordatorios en dos columnas.
- **Agenda:** tres columnas (cumpleaños, recordatorios, abandonados) que se apilan en móvil.
- **Ajustes:** dos paneles, copia de seguridad e instalación.

Hasta `768px` el índice pasa a barra superior desplazable, la rejilla de tarjetas a una columna, y todas las secciones de dos columnas de la ficha de persona se apilan.

## Elevation & Depth

Plano por defecto: las tarjetas de persona llevan un borde y solo ganan una sombra suave al pasar el puntero (`0 2px 10px`), nunca en reposo. Sombra real únicamente en el diálogo de confirmación (`0 24px 70px #1e130c26`, velo `#1e130c55`) y en el aviso flotante (`0 8px 28px #1e130c2a`).

**The Profundidad funcional Rule.** Una sombra en reposo significa "esto flota sobre la página"; en People's Hoard nada flota salvo diálogos y avisos.

## Shapes

Campos `6px`, botones y navegación `7px`, tarjetas `10px`, paneles `8px`, diálogo `12px`, chips `5px`. La línea de tiempo usa un punto de `8px` en `accent` y una línea vertical de `1px` en `line` entre entradas consecutivas. Los iconos son trazos SVG de 1,8px. No hay imágenes raster ni avatares generados.

## Components

### Buttons

Primario terracota con tinta blanca, secundario blanco con borde, destructivo sobre `danger-bg`. Altura mínima `38px` (`30px` en la variante `btn-sm` de listas y formularios en línea). Deshabilitado a opacidad 0,45. Las acciones de texto (`btn-link`) se subrayan al pasar el puntero.

### Person cards

Nombre y apodo, chips de círculo, chip de cumpleaños próximo si cae dentro de 14 días, y "Último contacto hace N días" en gris de apoyo. Toda la tarjeta es un enlace a la ficha; el hover solo añade sombra y borde, sin desplazamiento.

### Person page

Cabecera con acciones (Editar datos, Fusionar, Archivar, Borrar) siempre visibles; "Editar datos" sustituye la cabecera por un formulario completo con "Guardar datos" / "Cancelar", igual que el resto de la familia Hoard. Resumen y notas son textareas que guardan solas al perder el foco. Datos (hechos) y alias son listas editables con un formulario de una fila para añadir. La línea de tiempo antepone el formulario "He hablado hoy" a la lista, más reciente primero. Los recordatorios completados se pliegan bajo un `<details>` para no ensuciar la vista.

### Circle chips

Chip redondeado tipo filtro (`circle-filter`), con el nombre del círculo y su recuento en cifra tabular. El filtro activo usa `nav-active` / `nav-active-ink`, igual que la navegación, para que quede claro que es una selección, no una etiqueta informativa.

### Agenda

Tres paneles iguales. Cumpleaños ordena por días restantes y muestra la edad si se conoce el año. Recordatorios muestra la fecha, el texto y, si está ligado a una persona, un enlace a su ficha, con un botón "Hecho" que completa sin salir de la página. Abandonados muestra "hace N días" y la cadencia deseada, con un botón "He hablado hoy" que registra un contacto rápido al instante.

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
