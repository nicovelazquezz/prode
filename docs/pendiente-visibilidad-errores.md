# Visibilidad de errores en producción — pendiente

**Fecha:** 2026-05-11 (reescrito; descarta versión del 2026-05-08)
**Estado:** plan acordado, watchdog pendiente de código; Sentry alerts pendiente de configurar en su UI

## Contexto: por qué este doc cambió

Anteriormente este doc proponía construir un panel custom de errores adentro de `/admin` (con tabla `error_logs`, filtro Nest, dedup, página nueva). Lo descartamos porque **es sobreingeniería**: Sentry ya hace todo eso de fábrica (captura, dedup, dashboard, búsqueda, retención). Construir una versión peor adentro de la app cuesta 5-6 horas y deja una tabla más para mantener, sin ganar nada real.

El nuevo plan se apoya en lo que ya existe:

- **Sentry** para todo lo que pasa adentro del proceso (errores 5xx, exceptions, alertas configurables)
- **Docker logs** (via Dokploy panel) para investigación profunda — la log rotation ya configurada da 50MB × 5 services = ~250MB de historial, suficiente para los incidentes de las últimas horas
- **Watchdog** (único código nuevo) para detectar el caso "el backend entero murió y Sentry no manda nada porque no hay proceso vivo"

## Lo que tenés que hacer

### Parte 1 — Configurar alertas en Sentry (sin código, ~10 min)

Abrir el dashboard de Sentry del proyecto. Crear una alert rule:

- **Condición:** "Error rate" en backend supera X errores por minuto (sugerencia: empezar con 5 errores/5 min). Ajustar después si genera ruido o si se queda corto.
- **Acción:** notificar via email a tu cuenta. Si tenés Slack en tu workspace, sumar también una notificación al canal donde mirás cosas.
- **Filtros:** ignorar errores 4xx (no son problemas reales, son comportamiento esperado). Sentry ya filtra esto por nivel "error" vs "warning", pero verificar la regla.

**Importante:** la primera semana de prod, la alerta puede dispararse seguido mientras descubrís edge cases reales. Eso es bueno — querés enterarte. Si después del primer mes el ruido es alto, subir el threshold o agregar filtros por exception class.

### Parte 2 — Watchdog en wa-backend (código, ~1.5 horas)

Esto SÍ es código. Necesario porque cuando el backend principal muere completamente (OOM, crash en arranque, container que no levanta), Sentry no manda nada — no hay proceso vivo que reporte. El watchdog vive **afuera del backend principal**, en el service `wa-backend` que es independiente.

**Qué hace:**

- Un cron interno en `wa-backend` que cada 60 segundos hace fetch a `http://prode-backend:3001/health` (red interna de Docker, no pasa por internet)
- Mantiene contador de fallas consecutivas
- Cuando llega a 3 fallas consecutivas (≈3 minutos sin respuesta), manda UN WhatsApp al admin: "🚨 Backend caído desde HH:MM ART"
- Cuando el health vuelve a 200, resetea el contador y manda otro WA: "✅ Backend recuperado a HH:MM ART"
- Anti-spam: una vez que mandó "caído", no manda más alertas hasta que vuelva. Sin loops.

**Lo crítico que NO se puede olvidar:**

- El watchdog tiene que pingear el `/health` del **backend principal** (puerto 3001), no el suyo propio. wa-backend pingueándose a sí mismo no sirve para nada.
- El healthcheck del backend ya devuelve 503 si la DB cae y 200+degraded si Redis cae (lo arreglamos en otro fix). El watchdog solo alerta cuando el response es <200 o >=500 o timeout. **El caso "degraded por Redis" NO dispara WA** — el backend está vivo, solo se acumulan jobs; es ruido para el watchdog.
- Si wa-backend también muere, no te enterás vía watchdog. Acepté ese riesgo — wa-backend es muy chico (Baileys + Nest) y raramente muere sin que muera el backend también. Si querés cobertura full, usar UptimeRobot u otro servicio externo en lugar de este watchdog (5 min de setup en su UI).
- Los timestamps que manda por WA tienen que estar en hora ART, no UTC. Si pone UTC, vas a sumar 3 horas mentales en pánico.
- El interval (60s) y el threshold (3 fallas consecutivas) son razonables pero ajustables. Si querés enterarte más rápido, bajar a 30s + 2 fallas = ~1 minuto de detección.

**Lo que NO hace:**

- No reintenta el chequeo si la primera respuesta es lenta — un timeout cuenta como falla.
- No persiste el estado: si wa-backend reinicia, arranca el contador en 0. Eso significa que si backend está caído al momento del restart, vas a esperar 3 chequeos más (3 min) hasta la próxima alerta. Aceptable.
- No reemplaza Sentry. Sentry sigue siendo donde ves el detalle de qué falló adentro del backend cuando está vivo pero tirando errores.

### Parte 3 — NO se hace

Lo que estaba en el plan viejo y descartamos:

- ❌ Tabla `error_logs` en Postgres
- ❌ Filtro Nest global que escribe a esa tabla
- ❌ Endpoints `/admin/errors` y `/admin/errors/stats`
- ❌ Página `/admin/errores` con tabla y badge en sidebar

Todo eso lo cubre Sentry sin escribir código. Si en algún futuro lejano querés algo embebido en el panel admin (improbable), volvés a evaluarlo.

## Costo estimado

- Parte 1 (config Sentry): 10 min en la UI de Sentry. **No es código.**
- Parte 2 (watchdog): ~1.5 horas con tests.

Total: ~2 horas.

## Cuándo abordarlo

Antes de abrir la beta cerrada al primer grupo. Concretamente:

1. Deployás a prod (sin abrir al público todavía)
2. Configurás las alertas en Sentry — verificás que cuando tirás un error a propósito te llega el email
3. Implementás el watchdog
4. Recién después abrís a los 5-10 primeros usuarios

## Cuando lo retomes

El paso 1 (Sentry) es laburo en la UI, no requiere contexto técnico — podés hacerlo en 10 minutos. Si te trabás, el sistema viene con un wizard.

El paso 2 (watchdog) es código aislado en `wa-backend/src/`. Cuando llegues a implementarlo, los detalles concretos a definir son:

- Dónde vive el cron exactamente (un módulo nuevo `watchdog/` adentro de `wa-backend/src/`)
- Si el ping usa `fetch` nativo de Node 20 o axios (cualquiera, fetch alcanza)
- Cómo accede al cliente Baileys ya inicializado para mandar el WA (inyectar el service que ya manda mensajes)
- Variables de entorno nuevas que puede necesitar (probablemente: `BACKEND_HEALTH_URL`, `WATCHDOG_INTERVAL_MS=60000`, `WATCHDOG_FAILURE_THRESHOLD=3`)
