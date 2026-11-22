# Auditoría de Constancia: de la v1 a la v2

Fecha: 22 de noviembre de 2026 · Versión auditada: 1.0.0 · Versión corregida: 2.0.0

## Resumen

| Área | v1 | v2 |
|---|---|---|
| Pruebas automáticas | Ninguna | 15 unitarias + 15 de punta a punta, todas correctas |
| Accesibilidad (axe-core, WCAG 2.2 AA) | Contraste insuficiente en textos secundarios, de color y en botones | 0 hallazgos en todas las pantallas y hojas |
| Lighthouse (móvil) | — | Rendimiento 99 · Accesibilidad 100 · Buenas prácticas 100 · SEO 100 |
| Seguridad | Inyección de HTML posible por un respaldo manipulado; sin CSP | Datos saneados, CSP estricta con hash, prueba de ataque incluida |
| Gestión de errores | Un error dejaba la pantalla rota o perdía cambios sin avisar | Errores contenidos, avisos claros, reintentos automáticos, diagnóstico |
| Diseño | Emojis como íconos, barra fija, hojas a todo lo ancho | Íconos de línea consistentes, barra flotante de vidrio, hojas con margen (Liquid Glass) |

Métricas de Lighthouse en móvil con red 4G simulada:
- Primer contenido y contenido principal: 1.6 s.
- Tiempo de bloqueo: 0 ms.
- Desplazamiento visual (CLS): 0.

La app pesa 165 KB sin comprimir y 46 KB con gzip, y no tiene dependencias externas en tiempo de ejecución.

## Hallazgos y correcciones

### Seguridad

1. **Inyección de HTML desde un respaldo (alta).**
   - *Problema:* en la v1 el `id` de cada hábito se insertaba sin escapar en atributos `data-h="…"`. Un respaldo manipulado podía cerrar el atributo e inyectar HTML.
   - *Corrección:* los ids se sanean a `[a-z0-9_-]` y los textos se limpian de caracteres de control. Todo se escapa al pintar y los colores se validan como `#RRGGBB`.
   - *Prueba:* “Seguridad: un respaldo malicioso no ejecuta código”.
2. **Sin política de seguridad de contenido (media).**
   - *Corrección:* la web app instalada lleva una CSP que solo permite el script propio, verificado por su hash SHA‑256. Además usa `object-src 'none'`, `base-uri 'none'` y `form-action 'none'`.
   - *Prueba:* “La política de seguridad (CSP) bloquea scripts inyectados”.
3. **Dependencia de Google Fonts (baja).** La v1 cargaba una fuente externa. Eso exponía la IP del usuario a un tercero y fallaba sin conexión. *Corrección:* se usa la tipografía del sistema (SF Pro y SF Pro Rounded en iPhone).

### Integridad de datos y gestión de errores

4. **Datos locales dañados se perdían en silencio (alta).**
   - *Problema:* si el `localStorage` estaba corrupto, la v1 cambiaba a “solo memoria” y ya no guardaba nada, sin decirlo.
   - *Corrección:* la app guarda una copia del contenido dañado (`constancia.v1.danado`), avisa al usuario y sigue guardando normalmente.
   - *Prueba:* “Datos locales dañados…”.
5. **Cambios perdidos por fallas de red en la cuenta de Claude (alta).**
   - *Problema:* la v1 reintentaba una sola vez y después descartaba el cambio.
   - *Corrección:*
     - Cola por documento con reintentos exponenciales (1, 2, 4, 8 y 16 s).
     - Detección de “sin conexión”.
     - Reintento al volver la conexión o al regresar a la app.
     - Botón “Reintentar” y los cambios pendientes se conservan.
   - *Prueba:* “Cuenta de Claude: guarda, reintenta sin conexión…”.
6. **El último toque podía perderse al cerrar la app (media).** El guardado local tenía un retraso de 120 ms sin vaciarse al cerrar. *Corrección:* se guarda de inmediato en `pagehide` y al pasar a segundo plano.
7. **Dos pestañas se sobrescribían (media).** *Corrección:* sincronización con el evento `storage`.
8. **Acceso revocado sin manejo (media).** *Corrección:* modo de solo lectura con aviso. Los controles explican por qué no guardan.
9. **Importación sin validar valores (media).**
   - *Problema:* la v1 aceptaba negativos, `NaN`, cantidades enormes, días inexistentes, motivos inventados y archivos de cualquier tamaño.
   - *Corrección:* normalización estricta y límites (12 hábitos, 100 000 por registro, 5 MB por respaldo).
   - *Pruebas:* `normalizeMonth`, “Respaldo: copiar, rechazar inválidos e importar”.
10. **Fechas imposibles aceptadas (baja).** `2026-02-30` pasaba la validación. *Corrección:* `isDateKey` verifica la fecha real.
11. **Hábitos con nombre o id duplicado (baja).** *Corrección:* ids únicos y aviso de nombre repetido.
12. **Un error de pantalla dejaba la app en blanco (alta).**
    - *Corrección:*
      - El render, cada acción, cada formulario y cada hoja tienen su propio manejo de errores.
      - Hay manejadores globales para `error` y `unhandledrejection`.
      - Aparece un aviso “Algo no salió como esperaba” con “Reintentar”.
      - Si una pantalla no se puede dibujar, se muestra una pantalla de respaldo que ofrece copiar los datos.
    - *Prueba:* “Error inesperado: se contiene, se informa y se puede reintentar”.
13. **Sin diagnóstico (baja).** *Corrección:* Ajustes → Diagnóstico muestra la versión, el almacenamiento, el estado y los eventos recientes. Se puede copiar sin incluir hábitos ni registros.
14. **Actualizaciones silenciosas de la web app (baja).** *Corrección:* el caché tiene una versión derivada del contenido y aparece un aviso “Nueva versión disponible” para actualizar cuando el usuario quiera.

### Accesibilidad

15. **Contraste insuficiente (alta).** La v1 tenía:
    - texto terciario `#6E6E73` sobre negro, a 3.9:1;
    - texto rojo del hábito a 4.2:1;
    - texto blanco sobre azul `#0A84FF`, a 3.6:1.

    *Corrección:*
    - Se reajustaron los tonos.
    - El color de texto de cada hábito se aclara automáticamente hasta 4.5:1 (prueba unitaria para los 8 colores sobre los 3 fondos).
    - Los botones usan `#0071E3`, a 4.7:1.
    - El rojo de texto usa `#FF6961`.
16. **Foco en las hojas (media).** *Corrección:*
    - El fondo queda inerte (`inert`).
    - El foco entra a la hoja y regresa al botón que la abrió.
    - Escape cierra la hoja.
    - *Prueba:* “Teclado…”.
17. **Otros hallazgos de axe durante la v2 (corregidos):** orden de encabezados, mapa de calor desplazable sin teclado, `aria-selected` no permitido en `role="radio"`, nombre accesible distinto del texto visible en la semana y `lang` ausente dentro del visor.
18. **Áreas táctiles:** todos los controles miden 44 px o más.
19. **Reducción de movimiento:** las animaciones respetan `prefers-reduced-motion`.

### Diseño (nivel Apple, Liquid Glass de iOS 26/27)

- **Íconos:** de línea al estilo SF Symbols (subconjunto de Lucide, licencia ISC), en lugar de emojis. Los respaldos de la v1 se migran solos.
- **Barra de pestañas:** cápsula flotante de vidrio, con la pestaña seleccionada resaltada para leerla mejor.
- **Hojas inferiores:** flotan con margen, tienen esquinas de 34 px y fondo de vidrio, y se cierran arrastrando hacia abajo.
- **Barra compacta:** al desplazarse, el título aparece en una barra de vidrio.
- **Resumen del día:** al estilo de la app Actividad, con anillos y valores por hábito.
- **Confirmaciones breves:** cápsula superior (HUD) en lugar de un toast.
- **Formularios:** agrupados como en Ajustes de iOS, con guardar ✓ y cerrar ✕ en la cabecera de la hoja.

## Cómo repetir la auditoría

```bash
npm install
npm run build          # genera index.html, dist/constancia.html y sw.js
npm test               # 15 pruebas unitarias del núcleo
npm run test:e2e       # 15 pruebas de punta a punta con Playwright + axe-core
```

## Pendiente o no verificable aquí

- **iPhone físico:** no se probó en un iPhone real. Las pruebas usan Chromium con viewport y táctil de iPhone. Hay que confirmar en Safari de iOS el vidrio (`backdrop-filter`), el selector de hora y “Agregar a inicio”.
- **Base de datos de Claude:** se probó con un doble que tiene la misma interfaz, más una escritura y lectura real con borrado posterior. Las caídas de red reales del servicio no se pueden provocar desde aquí.
- **Compresión:** Lighthouse marcó “compresión de texto” porque el servidor local no comprime. GitHub Pages sirve con gzip.
