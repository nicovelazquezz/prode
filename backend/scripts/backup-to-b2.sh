#!/usr/bin/env bash
# Backup horario de la DB Postgres a Backblaze B2.
#
# Diseñado para correr desde un crontab del HOST (no del container Nest):
#   0 * * * * /Users/nicolas/.../backend/scripts/backup-to-b2.sh >> /var/log/prode-backup.log 2>&1
#
# Requiere instalado en el host:
#   - pg_dump (PostgreSQL client tools)
#   - gzip
#   - b2 CLI (https://www.backblaze.com/b2/docs/b2_command_line_tool.html)
#
# Variables de entorno (típicamente desde el .env del backend):
#   - DATABASE_URL                postgres://user:pass@host:port/db
#   - BACKUP_B2_BUCKET            nombre del bucket (ej: prode-backups)
#   - BACKUP_B2_KEY_ID            B2 application key id
#   - BACKUP_B2_APPLICATION_KEY   B2 application key
#
# Retención: NINGUNA — el cliente pidió "guardá todo hasta que yo diga
# basta". El bucket crece monotónico. Si querés purgar, hacelo a mano
# desde el panel B2 cuando decidas.
#
# Naming: prode-YYYY-MM-DDTHH-mm-ssZ.sql.gz (UTC, ordenable lexicográfico).
#
# Failure mode: cualquier error → exit non-zero → cron manda mail al
# dueño del crontab. NO se borra el archivo local en caso de fallo de
# upload — sirve para diagnóstico manual.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [[ -f "$ENV_FILE" ]]; then
  # Cargar .env preservando los valores tal cual (sin export agresivo).
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL no definida (revisá $ENV_FILE o env)}"
: "${BACKUP_B2_BUCKET:?BACKUP_B2_BUCKET no definida}"
: "${BACKUP_B2_KEY_ID:?BACKUP_B2_KEY_ID no definida}"
: "${BACKUP_B2_APPLICATION_KEY:?BACKUP_B2_APPLICATION_KEY no definida}"

LOCAL_DIR="${BACKUP_LOCAL_DIR:-/tmp/prode-backups}"
mkdir -p "$LOCAL_DIR"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"
FILENAME="prode-${TIMESTAMP}.sql.gz"
LOCAL_PATH="${LOCAL_DIR}/${FILENAME}"

echo "[$(date -u '+%FT%TZ')] Iniciando backup → ${FILENAME}"

# ── Dump ──────────────────────────────────────────────────────────────────
# --no-owner / --no-acl: salida portable entre roles distintos.
# --clean / --if-exists: el restore puede correr sobre una DB con datos.
pg_dump \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --dbname="$DATABASE_URL" \
  | gzip -9 \
  > "$LOCAL_PATH"

LOCAL_SIZE="$(stat -f%z "$LOCAL_PATH" 2>/dev/null || stat -c%s "$LOCAL_PATH")"
echo "[$(date -u '+%FT%TZ')] Dump local OK: ${LOCAL_SIZE} bytes"

# ── Upload B2 ─────────────────────────────────────────────────────────────
# Authorize idempotente — la CLI cachea credenciales en ~/.b2_account_info.
# Re-authorize cada corrida para mantener la sesión fresca y para que un
# rotate de keys no lo deje colgado.
b2 account authorize "$BACKUP_B2_KEY_ID" "$BACKUP_B2_APPLICATION_KEY" >/dev/null

b2 file upload \
  --quiet \
  "$BACKUP_B2_BUCKET" \
  "$LOCAL_PATH" \
  "${FILENAME}"

echo "[$(date -u '+%FT%TZ')] Upload B2 OK: b2://${BACKUP_B2_BUCKET}/${FILENAME}"

# ── Cleanup local ─────────────────────────────────────────────────────────
# Mantenemos los últimos N backups locales por si falla el upload de la
# próxima corrida y queremos recuperar manualmente. 24 = 1 día con cron
# horario, ajustar si hace falta.
KEEP_LOCAL="${BACKUP_KEEP_LOCAL:-24}"
ls -1t "${LOCAL_DIR}"/prode-*.sql.gz 2>/dev/null \
  | tail -n +$((KEEP_LOCAL + 1)) \
  | xargs -r rm -f

echo "[$(date -u '+%FT%TZ')] Backup completado."
