#!/bin/sh
# Database backups for Immich Showcase.
#
#   backup.sh          run forever: back up whenever the newest dump is older
#                      than BACKUP_INTERVAL_HOURS (checked every 10 minutes)
#   backup.sh once     make one backup now, prune, exit
#   backup.sh check    healthcheck: succeed if the newest dump is recent enough
#
# Dumps are pg_dump custom format (compressed). Restore with pg_restore; see README.
set -eu

DIR=/backups
INTERVAL_H=${BACKUP_INTERVAL_HOURS:-24}
KEEP=${BACKUP_KEEP:-14}

case "$INTERVAL_H$KEEP" in *[!0-9]*) echo "BACKUP_INTERVAL_HOURS and BACKUP_KEEP must be whole numbers" >&2; exit 2 ;; esac
[ "$KEEP" -ge 1 ] || { echo "BACKUP_KEEP must be at least 1" >&2; exit 2; }
[ "$INTERVAL_H" -ge 1 ] || { echo "BACKUP_INTERVAL_HOURS must be at least 1" >&2; exit 2; }

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

newest() { ls -1t "$DIR"/showcase-*.dump 2>/dev/null | head -n 1; }

# Seconds since the newest dump was written (very large if there is none).
age() {
  f=$(newest)
  if [ -z "$f" ]; then echo 999999999; else echo $(( $(date +%s) - $(stat -c %Y "$f") )); fi
}

backup() {
  ts=$(date -u +%Y%m%d-%H%M%S)
  out="$DIR/showcase-$ts.dump"
  [ -e "$out" ] && { sleep 1; ts=$(date -u +%Y%m%d-%H%M%S); out="$DIR/showcase-$ts.dump"; }
  tmp="$out.tmp"
  # Write to a temp file and verify it, so a partial or corrupt dump never
  # counts as a backup (and never causes a good one to be pruned).
  if pg_dump --format=custom --file="$tmp" && pg_restore --list "$tmp" >/dev/null; then
    mv "$tmp" "$out"
    log "backup ok: $(basename "$out") ($(stat -c %s "$out") bytes)"
  else
    rm -f "$tmp"
    log "backup FAILED"
    return 1
  fi
}

# Keep the newest $KEEP dumps. Only touches files this script creates.
prune() {
  ls -1t "$DIR"/showcase-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r f; do
    rm -f -- "$f"
    log "pruned $(basename "$f")"
  done
}

case "${1:-loop}" in
  once)
    backup
    prune
    ;;
  check)
    [ "$(age)" -le $(( (INTERVAL_H + 2) * 3600 )) ]
    ;;
  loop)
    rm -f "$DIR"/showcase-*.dump.tmp
    until pg_isready -q; do sleep 2; done
    log "backups every ${INTERVAL_H}h to $DIR, keeping $KEEP"
    trap 'exit 0' TERM INT
    while true; do
      if [ "$(age)" -ge $(( INTERVAL_H * 3600 )) ]; then
        if backup; then prune; fi
      fi
      sleep 600 &
      wait $!
    done
    ;;
  *)
    echo "usage: backup.sh [once|check]" >&2
    exit 2
    ;;
esac
