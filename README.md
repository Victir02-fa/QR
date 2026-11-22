# Constancia

Tu pizarra de hábitos diarios para iPhone. Marcas lo que cumpliste cada día (ejercicio, comer saludable, leer, no azúcar…). Lo ves en **anillos de progreso** y la app te dice **en qué fallas** para que mejores cada día.

Versión 2.0.0 · diseño Liquid Glass (iOS 26/27) · [Informe de auditoría](docs/auditoria.md)

## Qué hace

| Pestaña | Para qué sirve |
|---|---|
| **Hoy** | Resumen del día al estilo de la app Actividad (anillos y valores por hábito), tira de la semana y lista de hábitos. Los de sí o no se marcan con un toque; los de meta numérica tienen un control con − y +. |
| **Historial** | Calendario del mes con mini‑anillos por día (los días perfectos aparecen en amarillo) y mapa de calor de 12 meses, en general o por hábito. |
| **Análisis** | Cumplimiento de la semana y del mes, rachas y récords, tu día más difícil, tu hábito más débil, hábitos que fallan juntos, metas en las que te quedas cerca y motivos de falla con consejos. |
| **Ajustes** | Hábitos (agregar, editar, ordenar, archivar), horarios de mañana y noche, respaldo, modo ejemplo y diagnóstico. |

**Reglas.**
- Todos los hábitos son diarios.
- Un día pasado sin marcar cuenta como falla.
- Hoy no cuenta como falla hasta que termina el día.
- Si cambias una meta, los días anteriores conservan la meta que tenían.

## Instalar en el iPhone

1. En GitHub, ve a **Settings → Pages**. Elige **Deploy from a branch**, la rama con la app y la carpeta **/ (root)**.
2. Abre `https://victir02-fa.github.io/QR/` en **Safari** → **Compartir** → **Agregar a inicio**.

La app funciona sin conexión y guarda los datos en el iPhone. Cuando hay una versión nueva, aparece el aviso **Actualizar**.

## Desarrollo

```bash
npm install            # íconos (lucide-static) y axe-core, solo para desarrollo
npm run build          # src/ → index.html, dist/constancia.html, sw.js
npm test               # pruebas unitarias (node:test)
npm run test:e2e       # pruebas de punta a punta, robustez y accesibilidad (Playwright + axe-core)
npm run icons          # regenera src/icons.js si cambias la lista de íconos
```

```
src/core.js         Lógica pura: fechas, validación, métricas, hallazgos, respaldo, datos de ejemplo
src/app.js          Interfaz, almacenamiento con reintentos, gestión de errores y diagnóstico
src/styles.css      Diseño (tokens, Liquid Glass, accesibilidad)
src/shell.html      Estructura de la página
src/icons.js        Subconjunto de íconos Lucide (generado)
scripts/build.mjs   Construye la web app con CSP por hash y el service worker versionado
tests/              Pruebas unitarias (core.test.mjs) y de punta a punta (e2e/run.cjs)
dist/constancia.html  Página que se publica como artifact de Claude
index.html, sw.js   Web app instalable (generados; no editar a mano)
docs/               Auditoría y diseño de la etapa 2
```

**Almacenamiento.**
- **Artifact de Claude:** los datos van a la base de datos privada del artifact. Solo el dueño la lee y la escribe, y se sincroniza entre dispositivos.
- **Web app instalada:** los datos van a `localStorage`.

El formato es el mismo en los dos casos:

```jsonc
// "config"
{ "version": 2, "habits": [ { "id": "leer", "name": "Leer", "icon": "book-open", "color": "#00D8FF",
  "type": "count", "unit": "págs", "step": 5, "goals": [ { "from": "2026-11-22", "goal": 20 } ], "start": "2026-11-22" } ],
  "settings": { "morning": "08:00", "night": "21:00" } }
// "m-2026-11"
{ "days": { "22": { "leer": 15, "saludable": 1 } }, "reasons": { "21": { "leer": "cansancio" } } }
```

## Etapa 2

App nativa en SwiftUI con widgets en inicio y bloqueo, marcar desde el widget, notificaciones integradas e iCloud. El diseño está en [`docs/etapa-2-ios-nativa.md`](docs/etapa-2-ios-nativa.md).

Íconos: [Lucide](https://lucide.dev), licencia ISC.
