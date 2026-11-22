# Constancia

Tu pizarra de hábitos diarios para iPhone. Marcas cada día lo que cumpliste (ejercicio, comer saludable, leer, no azúcar…), lo ves en **anillos de progreso** y la app te dice **en qué fallas** para que mejores cada día.

## Qué hace

| Pestaña | Para qué sirve |
|---|---|
| **Hoy** | Anillos concéntricos del día, tira de la semana y lista de hábitos. Los hábitos de sí/no se marcan con un toque; los de meta numérica suman con `+10 min`, `+5 págs`, etc. |
| **Historial** | Calendario del mes con mini‑anillos por día (los días perfectos se marcan en dorado) y mapa de calor de los últimos 12 meses, en general o por hábito. |
| **Análisis** | Cumplimiento de la semana y del mes, rachas actuales y récords, tu día de la semana más difícil, tu hábito más débil, hábitos que fallan juntos, metas en las que “te quedas cerca” y tus motivos de falla más comunes. |
| **Ajustes** | Agregar, editar, ordenar o archivar hábitos; horarios de la mañana y la noche; respaldo (exportar e importar). |

**Mañana y noche.** Antes de mediodía la app te muestra el *plan de hoy* y lo que te faltó ayer. Después de la hora de la noche te muestra *cierra tu día* con lo que te falta. Para recibir notificaciones del iPhone, sigue los pasos de **Ajustes → Recordatorios** (dos automatizaciones en la app Atajos).

**Motivos de falla.** Cuando un día pasado queda incompleto, la app te pregunta por qué falló cada hábito: falta de tiempo, cansancio, se me olvidó, sin ganas, antojo, evento o salida, enfermedad u otro. Así el Análisis te muestra qué motivo se repite y te da un consejo para ese motivo.

**Reglas.** Todos los hábitos son diarios. Un día pasado sin marcar cuenta como falla. El día de hoy no cuenta como falla hasta que termina. Si cambias la meta de un hábito, los días anteriores conservan la meta que tenían.

## Instalarla en tu iPhone (etapa 1: web app)

1. En GitHub, entra a **Settings → Pages** de este repositorio.
2. En *Build and deployment* elige **Deploy from a branch**. Selecciona la rama donde está la app (por ejemplo `main`) y la carpeta **/ (root)**. Guarda.
3. En un par de minutos la app queda en `https://victir02-fa.github.io/QR/`.
4. Abre ese link en **Safari** desde tu iPhone → botón **Compartir** → **Agregar a inicio**.

Se abre a pantalla completa como cualquier app y funciona sin internet. Los datos se guardan **en ese iPhone**, así que usa *Ajustes → Copiar respaldo* de vez en cuando.

## Estructura

```
src/app.html          Fuente única de la app (HTML + CSS + JS, sin dependencias)
index.html            Web app generada a partir de src/app.html (no editar a mano)
manifest.webmanifest  Nombre, colores e íconos para "Agregar a inicio"
sw.js                 Service worker: funciona sin conexión
icons/                Ícono en SVG y PNG (180, 192, 512 y maskable)
scripts/build.mjs     Genera index.html: node scripts/build.mjs
docs/etapa-2-ios-nativa.md  Diseño de la app nativa con widgets
```

`src/app.html` también se publica tal cual como artifact de Claude. Ahí guarda los datos en la base de datos privada del artifact, que se sincroniza entre tus dispositivos. Como web app instalada usa `localStorage`. El formato de los datos es el mismo en las dos versiones, así que un respaldo sirve en cualquiera de ellas y también en la etapa 2.

## Formato de datos

```jsonc
// documento "config"
{ "habits": [ { "id": "leer", "name": "Leer", "icon": "📖", "color": "#00D8FF",
                "type": "count", "unit": "págs", "step": 5,
                "goals": [ { "from": "2026-11-22", "goal": 20 } ], "start": "2026-11-22" } ],
  "settings": { "morning": "08:00", "night": "21:00" } }

// un documento por mes: "m-2026-11"
{ "days":    { "22": { "leer": 15, "saludable": 1 } },
  "reasons": { "21": { "leer": "cansancio" } } }
```

## Etapa 2

La app nativa en SwiftUI agrega widgets reales en la pantalla de inicio y de bloqueo, marcar hábitos desde el widget, notificaciones integradas y respaldo en iCloud. El diseño completo está en [`docs/etapa-2-ios-nativa.md`](docs/etapa-2-ios-nativa.md).
