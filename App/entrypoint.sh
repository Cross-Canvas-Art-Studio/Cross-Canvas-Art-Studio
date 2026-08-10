#!/bin/sh
set -eu

APP_USER="${APP_USER:-appuser}"

# Auto-generate signing secrets if the operator did not supply them. Set these
# explicitly (see docker-compose.yml) to keep sessions/tokens valid across
# restarts.
if [ -z "${SECRET_KEY:-}" ]; then
  SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
  export SECRET_KEY
  echo "Generated ephemeral SECRET_KEY"
fi
if [ -z "${SECRETS:-}" ]; then
  SECRETS="$(python -c 'import secrets; print(secrets.token_hex(32))')"
  export SECRETS
  echo "Generated ephemeral SECRETS"
fi

# When started as root, prepare the data volume then drop to the unprivileged
# app user and re-exec this script.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/logs /data/output /data/uploaded /data/projects 2>/dev/null || true
  chown -R "$APP_USER":"$APP_USER" /data 2>/dev/null || true
  echo "Dropping privileges to '$APP_USER'"
  exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$0" "$@"
fi

WORKERS="${GUNICORN_WORKERS:-3}"
THREADS="${GUNICORN_THREADS:-2}"
echo "Starting Cross Canvas Art (gunicorn: ${WORKERS} workers x ${THREADS} threads)"
exec gunicorn \
  --bind 0.0.0.0:5000 \
  --workers "$WORKERS" \
  --threads "$THREADS" \
  --timeout 180 \
  --access-logfile - \
  --error-logfile - \
  app:app
