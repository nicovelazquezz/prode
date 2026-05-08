# Visibilidad de errores en producción — pendiente

**Fecha:** 2026-05-08
**Estado:** plan acordado, sin implementar

## Por qué

Hoy Sentry captura errores del backend y del frontend, pero **nadie está suscripto a alertas**. Si algo se rompe a las 3 AM del partido inaugural, te enterás cuando un usuario te escribe — no antes. Necesitamos algo que te de "el pulso del día" sin obligarte a entrar a Sentry todo el tiempo.

## La decisión

**Patrón B**: panel adentro de `/admin` + un solo WhatsApp crítico cuando todo el backend está caído. Sentry queda como está, para investigar a fondo cuando hace falta.

No se mandan WhatsApps por cada 5xx (sería spam). Solo 1 WA por evento "backend caído >2min".

## Tres pasos para implementarlo

Está pensado para hacerlo en 3 piezas chicas, en este orden. Cada una tiene sentido sola.

### Paso 1 — Captura de errores 5xx en el backend

**Qué hace:** cualquier excepción que termine devolviendo un código 500–599 al cliente queda registrada en una tabla nueva.

**Lo que tiene que estar:**

- Tabla nueva `error_logs` (separada de `audit_logs` — son cosas distintas, audit son acciones humanas, esto son fallas del sistema). Campos clave: timestamp, método HTTP, path, código de estado, mensaje truncado, **firstSeenAt**, **lastSeenAt**, **count**.
- Filtro global de Nest que captura las excepciones. **CRÍTICO:** este filtro NO debe romper la response al cliente si la escritura a la BD falla. Tiene que estar envuelto en try/catch y como mucho logear; el cliente igual recibe su 5xx.
- **Dedup:** si llega un error con el mismo `path + mensaje` que ya existe en los últimos 5 minutos, NO crear un row nuevo. Incrementar `count` y actualizar `lastSeenAt` en el row existente. Sin esto, un bug que dispara 200 errores idénticos te llena la tabla con basura repetida.
- Endpoints admin:
  - `GET /admin/errors?limit=50&offset=0` paginado, ordenado por lastSeenAt desc
  - `GET /admin/errors/stats` con contadores en ventanas: 1h / 24h / 7d
- **Solo 5xx.** 4xx (bad request, unauthorized, etc.) son comportamiento esperado, no son errores del sistema.
- **Solo backend.** Errores del frontend siguen yendo solo a Sentry — no se duplican acá.

### Paso 2 — Página del panel admin

**Qué hace:** una pantalla nueva en `/admin/errores` que muestra la tabla de forma legible.

**Lo que tiene que estar:**

- Tabla con columnas: hora (formato relativo "hace 5 min" + tooltip con timestamp completo en ART), método+path, código de estado, mensaje, "ocurrencias" (count del row).
- Filtro temporal: últimas 24h por defecto, con toggle para 1h o 7d.
- **Badge en el sidebar admin**: "🔴 N errores 24h" que linkea a la página. Este badge es la única señal pasiva que verás cuando entres al panel sin estar buscando errores específicos. Si el badge muestra 0 o no aparece, está todo bien.
- Botón "marcar como resuelto" en cada row (opcional, podría ser útil para limpiar visualmente lo que ya investigaste). Si lo agregamos, es un campo `resolvedAt` en el row, no se borra el dato.
- Link directo a Sentry desde cada row, si tenemos un Sentry event ID asociado. Para investigar el stack trace.

### Paso 3 — Watchdog para "backend caído" (alerta WhatsApp)

**Qué hace:** algo que te manda UN WhatsApp cuando el backend está completamente caído, no responde a `/health`.

**CRÍTICO** — esto NO puede vivir en el backend principal. Si el backend muere, cualquier monitor adentro del mismo proceso muere con él. Tiene que ser externo al backend.

**Tres opciones, decidí cuando llegues a este paso:**

1. **Adentro de `wa-backend`** (mi recomendación). Es un servicio independiente que ya tenés corriendo, ya tiene cliente Baileys conectado, y tiene su propia red. Agregar un cron interno que cada 60 segundos pingue `http://prode-backend:3001/health` (la red interna de Docker). Si 3 chequeos consecutivos fallan, manda WA al admin con el mensaje del último error. Después que vuelve, manda otro WA "backend recuperado". Así te enterás cuando se cayó y cuando volvió.

2. **UptimeRobot o similar** (servicio externo gratis hasta cierto punto). Ping a `https://api.prodeplus.com/health` cada 5 min, cuando detecta down hace webhook a wa-backend `/send` con Bearer token. Más robusto porque está fuera de tu infra completa, pero requiere setup en una tercera plataforma.

3. **Cron en el host de Dokploy** (afuera de los containers). curl al health, si falla manda WA. Funciona pero requiere meter scripts en el host fuera del repo, más difícil de mantener.

**Si elegís la 1 (adentro de wa-backend):**
- El cron del watchdog sí depende de wa-backend estar vivo. Si wa-backend también muere, no te enterás. Es un riesgo aceptable porque wa-backend es muy chico y es muy raro que muera sin que muera el backend también.
- Anti-spam: una vez que mandó "backend caído", no manda más alertas hasta que el backend vuelva. Después del recovery, sí avisa "backend recuperado". Después puede caer de nuevo y vuelve a alertar.
- El healthcheck del backend ya pinguea DB y Redis (lo arreglamos en otro fix). O sea: si Redis cae, /health devuelve 200 con `degraded` (no 503), entonces el watchdog NO va a alertar — porque el backend "técnicamente vivo, sirve lecturas". Solo alerta si DB cae (el caso real de "está todo muerto"). Esto es deliberado.

## Lo que NO está en este plan

- **No alertas por cada 5xx**: ya hablamos, sería spam. El panel cubre eso.
- **No alertas para errores del frontend**: solo Sentry. Si vale la pena después, lo agregamos.
- **No reemplazar Sentry**: este panel es complementario. Cuando hay un error críptico que necesita stack trace, vas a Sentry.
- **No retención larga de errores**: la tabla puede crecer si no la limpiás. Sumar después una limpieza automática (ej: borrar errores resueltos con >30 días, o `count`+`lastSeenAt` viejos). No urgente al principio.

## Cosas que vas a olvidarte si no las dejo escritas acá

- **El filtro de Nest tiene que ser GLOBAL**, registrado en `app.module.ts` o en `main.ts` con `app.useGlobalFilters()`. Si lo metés en un solo controller no captura todo.
- **El orden importa**: si ya hay otros filters globales (ej: para HTTP exceptions de Nest), el orden de registro define cuál maneja qué. El filter de error_logs tiene que correr DESPUÉS del filter que formatea respuestas, para no interferir.
- **El mensaje truncado**: límite recomendado 500 chars en la columna `message`. Sin truncar, un stack trace largo te puede explotar la BD.
- **El watchdog NO tiene que pingear DOS COSAS distintas**: solo el `/health` del backend. No el de wa-backend, no Postgres directo. Una sola fuente de verdad.
- **El watchdog tiene que respetar el TZ ART** al formatear los timestamps que manda por WA. Si pone hora UTC vas a sumar confusión a las 3am.
- **Si vas con UptimeRobot, configurá el webhook con un secreto que también valide wa-backend** (sino cualquiera puede mandarte WAs falsos haciendo POST a tu /send).
- **No usar el `audit_logs` para esto.** Audit es "qué hizo cada admin/user". Errores son "qué falló del sistema". Mezclarlos te confunde después.

## Costo estimado

- Paso 1 (backend capture): ~2 horas con tests
- Paso 2 (página admin + badge): ~2 horas
- Paso 3 (watchdog): ~1.5 horas si va en wa-backend, ~30 min si UptimeRobot

Total para tener todo: medio día de laburo bien hecho.

## Cuando lo retomes

Empezá por Paso 1 (sin él, los otros no tienen datos para mostrar). Una vez que el filter está capturando, podés ver la tabla `error_logs` directamente con `psql` para verificar que está agarrando los errores antes de invertir tiempo en la UI.

Después Paso 2 cuando tengas datos reales para diseñar la tabla.

Paso 3 podés hacerlo último o saltearlo si tenés UptimeRobot configurado.
