# Etapa 2: app nativa para iPhone con widgets

La etapa 1 (la web app) ya define la experiencia: anillos, semana, historial, análisis y motivos de falla. La etapa 2 la lleva a una app nativa para sumar lo que una web app no puede hacer en iOS:

- **Widgets reales** en la pantalla de inicio y en la de bloqueo.
- **Marcar hábitos desde el widget**, sin abrir la app.
- **Notificaciones locales** en la mañana y en la noche. La de la noche se cancela sola si ya cumpliste todo.
- **iCloud**: los datos te siguen a un iPhone nuevo, sin respaldos manuales.

## Lo que necesitas

| Requisito | Detalle |
|---|---|
| Mac | Con Xcode 16 o más reciente (gratis en la Mac App Store). |
| iPhone | iOS 17 o más reciente: los widgets interactivos lo requieren. |
| Cuenta de Apple | **Gratis:** instalas desde Xcode con tu Apple ID, pero hay que reinstalar cada 7 días y no hay iCloud. **Apple Developer, $99 USD al año:** se instala por TestFlight, no caduca e incluye iCloud. |

## Arquitectura

```
Constancia (app, SwiftUI)
├── Modelo compartido (Swift Package "ConstanciaKit")
│   ├── Habit, DayLog, FailReason        ← mismo formato de datos que la web app
│   ├── Metrics (rachas, tasas, patrones) ← port directo de las funciones de src/app.html
│   └── Store (SwiftData + CloudKit, en un App Group)
├── Pantallas: Hoy · Historial · Análisis · Ajustes   ← mismas que la web app
├── Notificaciones (UserNotifications)
└── Importar respaldo .json de la web app

ConstanciaWidgets (extensión WidgetKit)
├── Widget pequeño     → anillos concéntricos de hoy + "2 de 4"
├── Widget mediano     → anillos + lista de hábitos con botón ✓ / +10 (App Intents)
├── Widget grande      → anillos de la semana + hábitos de hoy
├── Pantalla de bloqueo: circular (anillo del día), rectangular (lo que falta)
└── Intents: MarcarHabitoIntent, SumarCantidadIntent
```

Lo clave es el **App Group**: la app y los widgets leen la misma base de datos. Cuando tocas ✓ en el widget, el App Intent guarda el cambio y llama `WidgetCenter.shared.reloadAllTimelines()`, y los anillos se actualizan al instante.

## Modelo de datos (SwiftData)

```swift
@Model final class Habit {
    @Attribute(.unique) var id: String
    var name: String
    var icon: String
    var colorHex: String
    var kind: Kind              // .check o .count
    var unit: String
    var step: Double
    var goals: [GoalChange]     // [{from: "2026-11-22", goal: 20}]: la meta vigente cada día
    var start: String           // "AAAA-MM-DD"
    var archivedAt: String?
    var order: Int
}

@Model final class Entry {      // un registro por hábito y día
    var habitId: String
    var day: String             // "AAAA-MM-DD"
    var value: Double           // check: 0 o 1 · count: cantidad
    var reason: String?         // "tiempo", "cansancio", "olvido", "ganas", "antojo", "social", "salud", "otro"
}
```

Las reglas son las mismas que en la web app:
- Un día pasado sin cumplir es falla.
- Hoy no cuenta como falla hasta que termina el día.
- La meta vigente de cada día sale de `goals`.

## Widgets

| Tamaño | Contenido | Interacción |
|---|---|---|
| Pequeño | Anillos de hoy, “2 de 4” y racha 🔥 | Tocar abre la app en Hoy |
| Mediano | Anillos y los 4 hábitos con su progreso | Botón ✓ (sí/no) y +paso (meta numérica) en cada fila |
| Grande | Semana con mini‑anillos, hábitos de hoy y lo que falló ayer | Botones por hábito |
| Bloqueo circular | Un anillo con el % del día | — |
| Bloqueo rectangular | “Te faltan: Leer 5/20, No azúcar” | — |

La línea de tiempo del widget se regenera a medianoche, para empezar el día en cero, y cada vez que cambias algo.

## Notificaciones

- **Mañana**, a la hora que elijas: “☀️ Plan de hoy: 30 min de ejercicio, comer saludable, 20 págs, no azúcar”.
- **Noche**, a la hora que elijas: “🌙 Te faltan 2: Leer (5/20) y No azúcar”. Al completar todo, la app cancela la notificación de la noche. Si fallaste algo, la app te pide el motivo al abrir la notificación.

## Migración desde la web app

En la web app usas **Ajustes → Copiar respaldo** o **Descargar respaldo**. En la app nativa usas **Ajustes → Importar respaldo**. El JSON tiene `config` y un documento `m-AAAA-MM` por mes (el formato está en el README). Se importa tal cual.

## Plan de trabajo sugerido

1. Proyecto Xcode con App Group y SwiftData; port del modelo y de las métricas, con pruebas que comparen contra la web app.
2. Pantallas Hoy e Historial.
3. Widgets pequeño, mediano y de bloqueo con App Intents.
4. Análisis y motivos de falla.
5. Notificaciones e importación del respaldo.
6. iCloud (CloudKit) y TestFlight.
