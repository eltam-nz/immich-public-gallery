#!/bin/sh
# One-shot migrator. Runs as the DB owner, creates the least-privilege role
# used by public-api, then applies any migrations not yet recorded.
set -eu
: "${PUBLIC_DB_PASSWORD:?PUBLIC_DB_PASSWORD is required}"

until pg_isready -q; do echo "waiting for postgres..."; sleep 1; done

psql -v ON_ERROR_STOP=1 -v pw="$PUBLIC_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE showcase_public LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'showcase_public')\gexec
ALTER ROLE showcase_public WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'pw';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for f in /migrations/*.sql; do
  name=$(basename "$f")
  applied=$(psql -tAq -v name="$name" <<'SQL'
SELECT 1 FROM schema_migrations WHERE name = :'name';
SQL
)
  if [ "$applied" = "1" ]; then
    echo "skip  $name"
  else
    echo "apply $name"
    { echo 'BEGIN;'; cat "$f"; echo "INSERT INTO schema_migrations (name) VALUES ('$name');"; echo 'COMMIT;'; } \
      | psql -v ON_ERROR_STOP=1 -q
  fi
done
echo "migrations complete"
