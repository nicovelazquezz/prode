# Drill de restore desde B2 — pendiente

**Fecha:** 2026-05-08
**Estado:** plan acordado, sin probar todavía

## Por qué

Tenés `backup-to-b2.sh` corriendo cada hora en el host del servidor de producción. Sube un dump de Postgres a Backblaze B2. Eso lo configuraste hace tiempo y arrancó OK.

**Pero nunca lo restauraste.** Un backup que no probaste no es un backup. La primera vez que vas a usarlo es exactamente cuando estás corriendo (BD corrupta, ataque, deploy roto que metió mal una migración destructiva). En ese momento NO querés descubrir que el dump está incompleto, que faltan permisos, que el formato no era el correcto, o que la versión de Postgres del dump no es compatible.

Si se rompe la BD durante el Mundial (escenario peor: pleno partido, 500 usuarios), tenés que poder restaurar SIN improvisar.

## Lo que tenés que hacer

Un **drill**: bajar el último dump de B2, levantarlo en una BD temporal (local o staging), verificar que está OK. Una vez. Y documentar los pasos exactos para que en pánico no improvises.

Esto es laburo operativo, no de código. ~30-45 minutos la primera vez. Después corrés el script y demora 5-10 min.

## Lo que tiene que estar

### Script de drill (sugerido `scripts/restore-drill.sh`)

Un script que automatiza la verificación. Pseudo-flujo:

1. Listar los últimos 10 backups de B2 (por nombre/fecha, más recientes primero)
2. Bajar el más reciente a `/tmp/`
3. Verificar que el archivo no está corrupto (`gunzip -t`)
4. Crear una BD temporal `prode_restore_test` (o lo que sea, local)
5. Restaurar el dump ahí (`gunzip < ... | psql ...`)
6. Correr una serie de checks de integridad (ver abajo)
7. Imprimir un reporte: ✓ / ✗ por cada check
8. Limpiar (drop la BD temporal, borrar el archivo)

### Checks de integridad mínimos

Cosas que el script tiene que verificar para que el drill realmente sirva (no solo "se restauró sin tirar error"):

- **Cuántas tablas existen** vs cuántas debería haber (sacar el número del schema actual). Si faltan, dump roto.
- **Row counts de tablas críticas**: `User`, `Match`, `Prediction`, `SpecialPrediction`, `Payment`, `Entry`. Comparar con un mínimo razonable (ej: si `Match` tiene <72 filas, algo anda muy mal).
- **Foreign keys**: hacer un par de joins simples (ej: `SELECT * FROM predictions p JOIN matches m ON p.matchId = m.id LIMIT 1`). Si tira error, las FKs no se restauraron.
- **Índices**: `\di` en psql, contar cuántos índices hay. Comparar con los esperados (~30 según schema actual).
- **Migrations table**: `SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5`. Verificar que la última migración aplicada coincide con la que está en `backend/prisma/migrations/` más reciente.

### Documentación del procedimiento

Un `.md` con la checklist exacta para correrlo en pánico. Si ya tenés un `docs/deployment.md`, agregar una sección "Restore desde B2 en emergencia" con:

1. Pre-requisitos (credenciales B2, acceso a postgres prod, disco con espacio)
2. Pasos numerados (download → verify → drop tables o nueva BD → restore → verify checks)
3. Qué hacer si falla cada paso
4. **Qué hacer DESPUÉS del restore exitoso**: bumpear connection strings de la app, reinicio de containers, revisar diferencia de datos vs el momento del backup

## Cosas que vas a olvidarte si no las dejo escritas acá

- **NUNCA correr el restore directamente sobre la BD de prod.** El flujo correcto es: dropear / crear nueva BD, restaurar ahí, validar, después switchar la connection string de la app. Si restaurás encima de prod y el dump tenía un problema, perdiste todo.

- **El nombre del archivo en B2 incluye timestamp UTC** (ej: `prode-2026-05-08T14-30-00Z.sql.gz`). El TZ del backup-to-b2.sh está hardcodeado en UTC para que los nombres sean lexicográficamente ordenables. No te confundas con la hora ART cuando elegís el "más reciente".

- **B2 tiene retención infinita por ahora** (decisión del cliente: "guardá todo"). Quiere decir que la lista de backups crece. El drill solo agarra el más reciente. Eventualmente vas a querer una limpieza automática de B2 (B2 tiene "lifecycle rules" para borrar archivos viejos), pero por ahora no es urgente.

- **El dump es de TODA la BD**, no por tabla. No podés "restaurar solo Match" — restaurás todo. Si necesitás restaurar parcial (ej: el admin borró por accidente unos rows), la única opción es: restaurar todo a una BD temporal, sacar los datos a mano con SQL, insertarlos en prod. No es trivial. Documentar este escenario en el .md también.

- **El drill NO verifica que las extensiones de Postgres están** (ej: `pgcrypto` para `gen_random_uuid` si la usaras, etc.). Si Postgres prod tiene extensiones, el dump las exporta pero la BD destino tiene que tenerlas instaladas también. Para Postgres alpine puede faltar alguna. Verificar en el primer drill y documentar si hay que ejecutar `CREATE EXTENSION ...` antes del restore.

- **El volumen `prode-wa-data` (sesión Baileys de WhatsApp) NO se backupea hoy.** Si se pierde ese volumen, hay que re-escanear el QR. Eso es OTRO pendiente separado (ver `docs/pendiente-backup-wa-volumen.md` cuando lo escribamos).

- **Si tenés que restaurar en serio durante el Mundial**, antes de tocar la BD: notificá a los usuarios que el sistema va a estar caído por X minutos. Probablemente vía WhatsApp masivo desde wa-backend. Esto debería estar en el runbook también.

- **Cuando corras el drill por primera vez**: tomá nota de cuánto tarda. Si tarda 2 minutos, OK. Si tarda 15 minutos, eso es el RTO real (recovery time objective) en pánico — más eso que tarde en notar el problema. Saberlo te da margen para decidir si "restauramos ahora" o "pateamos al admin de turno".

## Cuándo correrlo

- **Antes del 11 de junio (kickoff)**: una vez sí o sí, para verificar que todo el flujo funciona.
- **Mensualmente** después: cron interno tuyo en el calendario, no automático. Solo asegurarse que sigue funcionando.
- **Después de cada migración Prisma destructiva**: importante porque el schema cambió y el dump anterior puede no ser compatible con un código nuevo.

## Lo que NO está en este plan

- **Restore automatizado en CI** (overkill para un proyecto de este tamaño)
- **Replicación de Postgres en standby** (complica deploy mucho, no necesario para 500 users)
- **Point-in-time recovery con WAL shipping** (idem, overkill)

Esto es restore manual desde dump horario. Es lo justo para no improvisar el día del partido.

## Costo estimado

- Escribir el script + correr el primer drill: ~1 hora
- Documentar el runbook: ~30 min
- Total: medio día con buffer

## Cuando lo retomes

1. Verificá primero que `backup-to-b2.sh` está corriendo en el host actual (`crontab -l` en el server). Si no está corriendo, este drill no tiene sentido.
2. Confirmá que tenés las credenciales B2 a mano (account ID, application key, bucket name).
3. Probá el script en local primero. NUNCA en el server de prod. Una vez que pasa los checks en local, opcionalmente corré una vez en staging si tenés.
