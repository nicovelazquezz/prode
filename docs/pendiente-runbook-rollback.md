# Runbook de rollback — pendiente

**Fecha:** 2026-05-08
**Estado:** plan acordado, sin escribir el procedimiento exacto todavía

## Por qué

Las imágenes Docker ya están pinneables con `${IMAGE_TAG}` (lo arreglamos en el primer fix de esta tanda). Técnicamente, rollback es posible. **Pero no hay procedimiento documentado.** El día que se rompa un deploy, en pánico, vas a improvisar — buscando commits en git, intentando cosas en Dokploy, perdiendo minutos preciosos mientras los usuarios ven la app rota.

Necesitás una checklist clara para seguir paso a paso. Sin pensar.

## Lo que tiene que estar

Un `.md` (o sección en `docs/deployment.md`) titulado tipo "Rollback en pánico" con cuatro escenarios cubiertos. Cada uno con pasos numerados que se siguen sin pensar.

### Escenario 1: rollback simple (código nuevo rompió, sin migración)

Pasos:

1. Identificar el commit anterior. `git log --oneline -10 origin/main` desde local. Anotar el SHA del commit que estaba antes del deploy roto.
2. En Dokploy panel → Environment Variables → cambiar `IMAGE_TAG` al SHA viejo.
3. Forzar redeploy desde el panel.
4. Verificar `https://api.prodeplus.com/health` devuelve `ok`.
5. Verificar que la app funciona (entrar como user de prueba).

**Pre-requisito:** la imagen del SHA viejo tiene que seguir existiendo en el host de Docker. Si Docker hizo prune (limpieza de imágenes viejas), el `IMAGE_TAG` apunta a algo que no existe y el deploy falla. Solución: rebuild a partir del commit (ver Escenario 2).

### Escenario 2: rollback cuando la imagen previa ya no existe

Pasos:

1. Identificar el commit anterior (igual que arriba).
2. En local, hacer `git checkout <sha-viejo>`.
3. Trigger deploy desde Dokploy (al rebuild, va a buildear la imagen del commit viejo y taggearla con el `IMAGE_TAG` actual).
4. **Cuidado:** algunos cambios entre el commit nuevo y el viejo pueden requerir reinstalar dependencias (cambios en `package.json`). Si el deploy falla, revisar los logs de build.
5. Verificar health.

### Escenario 3: rollback con migración destructiva involucrada

**Este es el peor.** El deploy nuevo metió una migración Prisma que dropeó una columna o tabla. El código viejo espera esa columna. Volver el código solo NO ALCANZA — la BD ya está mutada.

Pasos:

1. **Pará todo primero**: bajar los containers de backend y frontend (Dokploy → stop). No hagas rollback de código mientras la BD está rota.
2. **Notificar a los usuarios** (WhatsApp masivo, mensaje en la app si podés): "Estamos resolviendo un problema técnico. Esperá X minutos."
3. **Restore desde B2**: bajar el dump más reciente anterior al deploy roto (revisar timestamps en B2). Seguir el runbook de restore (`docs/pendiente-restore-drill.md` cuando exista) para meter ese dump en una BD nueva o sobre la actual previo backup de seguridad.
4. **Validar la BD**: verificar que las tablas y datos están como esperás. Mismos checks del drill de restore.
5. **Hacer el rollback de código** (Escenario 1 o 2).
6. **Levantar containers** y verificar.

**Tiempo estimado:** 30-60 minutos en el peor caso. El RTO real depende de cuán rápido bajes el dump de B2 y cuán grande sea (la BD del prode no es enorme — debería ser cuestión de minutos restaurar).

### Escenario 4: rollback fallido / "no se puede volver"

Si al intentar rollback algo se complica más (la BD se corrompe en el restore, el commit anterior tampoco anda, lo que sea), tenés dos opciones:

1. **Modo manteniendo lo roto pero con workaround**: si solo una funcionalidad está rota (ej: pagos no funcionan pero el resto sí), avisar a los usuarios "los pagos están pausados, los habilitamos en X horas" y dejar el sistema corriendo mientras investigás con calma. No es ideal pero gana tiempo.

2. **Modo "sitio en mantenimiento"**: bajar todo y poner una página estática que diga "Volvemos en X horas". Frontend de Next puede servir un `503.html` o algo así. Tendrías que tener algo preparado para esto.

Por ahora la decisión es: **NO preparamos la página de mantenimiento.** Si pasa el escenario 4, improvisás. Es escenario muy improbable.

## Cosas que vas a olvidarte si no las dejo escritas acá

- **Las migraciones Prisma NO tienen `down`**. Esto es crítico. No hay un comando `prisma migrate undo`. Si una migración rompió la BD, el único camino es restore desde dump.

- **El `IMAGE_TAG` en Dokploy panel afecta SOLO el próximo deploy.** No bajes el container manualmente esperando que vuelva con la imagen vieja — Dokploy redeploya con el tag actual del panel. Cambiá el panel ANTES de pedir redeploy.

- **`prisma migrate deploy` se ejecuta en el `start.sh` del backend**. Esto es importante porque significa que cada vez que arranca el container backend, intenta correr migraciones pendientes. **Si vas a un commit viejo y la BD tiene una migración más nueva aplicada**, el `migrate deploy` no se queja (las migraciones aplicadas están registradas en `_prisma_migrations`). Pero si vas a un commit viejo cuya migración nunca se aplicó, intentará correrla. Hay que tener cuidado con qué commit elegís de target del rollback.

- **Cuando hacés rollback, los logs viejos del container roto se pierden** (con el log rotation que pusimos). Si querés guardar evidencia para investigar después, hacé `docker logs prode-backend > /tmp/backend-pre-rollback.log` ANTES de redeployar.

- **No hagas force push a main para "deshacer" un commit malo.** Eso reescribe historia y confunde a cualquiera que tenga el repo clonado. La salida correcta es: `git revert <sha-malo>` y deploy del revert.

- **Post-rollback, anotá lo que pasó.** Una sola línea en un archivo `docs/incidents.md` (que podemos crear cuando haga falta) tipo "2026-06-15 22:30: deploy abc123 rompió pagos por X. Rollback a def456. Causa raíz: Y. Fix: Z." Vas a olvidarte si no lo anotás. Cuando reintentes el cambio que rompió, vas a querer ese contexto.

- **Si el deploy roto fue de frontend solamente** (típicamente cambio de UI), no tocás backend ni BD. Solo el rollback del frontend container alcanza.

## Lo que NO está en este plan

- **Rollback automático ante errores en producción** (overkill, además requiere alertas confiables que todavía no tenemos)
- **Blue/green deployment** (overkill para single-instance, complica la infra)
- **Page de mantenimiento estática** (escenario 4, decidiste improvisar si pasa)

## Costo estimado

- Escribir el runbook completo (los 4 escenarios con pasos numerados específicos del entorno tuyo): ~1 hora
- Hacer un dry-run del Escenario 1 contra staging para verificar que los pasos funcionan: ~30 min
- Total: ~1.5 horas

## Cuando lo retomes

1. Antes de escribir, abrí el panel de Dokploy y anotá EXACTAMENTE dónde se cambia `IMAGE_TAG`, qué botones son los de "redeploy", etc. Pasos genéricos no sirven en pánico — necesitás las capturas mentales de tu propio panel.

2. Una vez escrito, hacé un dry-run del Escenario 1: deployás un commit cualquiera, después cambiás el `IMAGE_TAG` al anterior, verificás que vuelve. Esto valida que tu runbook sirve.

3. El Escenario 3 (con migración destructiva) NO lo pruebes contra prod. Pruébalo contra staging si tenés. Si no tenés staging, el dry-run es solo el de Escenario 1 — el resto queda como "espero que funcione cuando haga falta", documentado lo mejor posible.
