# Backup horario a Backblaze B2

Script: [`backup-to-b2.sh`](./backup-to-b2.sh)

## Setup inicial (una vez por host de prod)

### 1. Instalar dependencias

```bash
# pg_dump (si no lo tenés)
brew install postgresql        # macOS
# o:  apt install postgresql-client   # Linux

# B2 CLI
pip install b2
# o el binario standalone: https://www.backblaze.com/b2/docs/b2_command_line_tool.html
```

### 2. Crear bucket en Backblaze B2

1. Crear cuenta en https://www.backblaze.com (plan free incluye 10 GB).
2. Crear bucket privado, nombre sugerido `prode-backups`.
3. Crear application key:
   - Solo permisos `listAllBucketNames`, `listFiles`, `writeFiles` sobre
     el bucket creado (no permisos de delete).
   - Anotar `keyId` y `applicationKey`.

### 3. Configurar variables en `backend/.env`

```bash
# Backup B2 (T12 — Wave 4)
BACKUP_B2_BUCKET=prode-backups
BACKUP_B2_KEY_ID=K003abcdef0123456789
BACKUP_B2_APPLICATION_KEY=K003abc...
# Opcional — defaults: /tmp/prode-backups, 24
BACKUP_LOCAL_DIR=/var/lib/prode-backups
BACKUP_KEEP_LOCAL=48
```

### 4. Probar manualmente

```bash
cd backend && bash scripts/backup-to-b2.sh
```

Tiene que terminar con `Backup completado.` y dejar el archivo en B2 +
en `/tmp/prode-backups/` (o donde apuntes `BACKUP_LOCAL_DIR`).

### 5. Crontab

Editar el crontab del host (NO del container) con `crontab -e`:

```cron
# Prode — backup horario a B2 (corre 0 */1 = en punto cada hora)
0 * * * * /Users/nicolas/.../prode/backend/scripts/backup-to-b2.sh >> /var/log/prode-backup.log 2>&1
```

Verificá con `crontab -l`. Si el cron de tu host está en otro PATH, agregá
al inicio del crontab:

```cron
PATH=/usr/local/bin:/usr/bin:/bin
```

## Restore

```bash
# Bajar el dump más reciente
b2 file download b2://prode-backups/prode-2026-06-12T03-00-00Z.sql.gz ./
gunzip prode-2026-06-12T03-00-00Z.sql.gz

# Aplicarlo a una DB limpia
psql "$DATABASE_URL" < prode-2026-06-12T03-00-00Z.sql
```

El dump se hace con `--clean --if-exists`, así que se puede aplicar
sobre una DB con datos sin `psql -c "DROP DATABASE..."` previo.

## Retención

**No hay retención automática.** El bucket crece monotónico hasta que
manualmente borres archivos viejos desde el panel B2.

Costo estimado para volumen del Mundial (~500 users × 8 semanas × 24
horas × ~200KB por dump): **~280 MB total ≈ $0.001/mes en B2**.

## Failure modes

- Si el `pg_dump` falla, el script tira con exit non-zero. El cron del
  host manda mail al owner del crontab.
- Si el upload a B2 falla, **el dump local queda intacto** en
  `BACKUP_LOCAL_DIR` para diagnóstico. La próxima corrida horaria intenta
  de nuevo (genera otro dump nuevo, no resube el viejo — sólo diferencia
  ~200KB de overhead).
- Si el host se cae: la DB sigue en pie, los backups esperan a que
  vuelva el cron.
