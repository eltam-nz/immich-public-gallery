#!/usr/bin/env bash
# Optional browser checks for the public site and the admin app:
# screenshots at phone and desktop sizes, accessibility (axe-core), tap-target
# and text sizes, no sideways scrolling, and the main admin phone workflows.
#
# Needs: Docker, `pnpm install`, Node with Playwright + Chromium available to
# `require('playwright')`, and axe-core (`npm install --prefix test/ui`).
# Screenshots go to test/ui/shots and test/ui/admin-shots.
#   ./test/ui/run.sh                 # builds images
#   E2E_NO_BUILD=1 ./test/ui/run.sh  # uses existing images
set -euo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=immich-showcase
export DB_OWNER_PASSWORD=owner-ui-pw PUBLIC_DB_PASSWORD=public-ui-pw ADMIN_DB_PASSWORD=admin-ui-pw
export PUBLIC_ID_SECRET=ui-secret-ui-secret-ui-secret-ui-secret-1
export IMMICH_NETWORK=showcase_test_immich SHARED_LINK_KEYS=test-shared-link-key
export SITE_TITLE="Our Family Photos" PUBLIC_SITE_URL=https://gallery.example.com MOCK_EXTRA_PHOTOS=12
export DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/showcase-ui.XXXXXX")
DC="docker compose -f docker-compose.yml -f docker-compose.test.yml"

node test/mock-immich/make-fixtures.mjs >/dev/null
docker network inspect "$IMMICH_NETWORK" >/dev/null 2>&1 || docker network create "$IMMICH_NETWORK" >/dev/null
$DC down -v --remove-orphans >/dev/null 2>&1 || true
$DC up -d ${E2E_NO_BUILD:+--no-build}
cleanup() {
  [ "${KEEP:-}" ] && { echo "kept stack; data in $DATA_DIR"; return; }
  $DC down -v >/dev/null 2>&1
  docker run --rm -v "$DATA_DIR:/d" postgres:16-alpine sh -c 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1
  rmdir "$DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})"; }
for i in $(seq 1 90); do
  n=$(curl -fsS http://127.0.0.1:8088/api/photos 2>/dev/null | json 'd.length' 2>/dev/null || echo 0)
  [ "$n" = 15 ] && break; sleep 1
done
[ "$n" = 15 ] || { echo "stack did not publish 15 photos (got $n)"; exit 1; }

# Seed: three collections; New Zealand gets six NZ photos, the others start empty.
export ACCESS_TOKEN=$(curl -fsS "http://127.0.0.1:2283/__control/sign?email=admin@example.com&exp=7200")
H=(-H "Cf-Access-Jwt-Assertion: $ACCESS_TOKEN" -H "x-showcase-admin: 1" -H "content-type: application/json")
A=http://127.0.0.1:8089
for body in '{"title":"New Zealand 2025","slug":"new-zealand-2025","description":"A year of trips around Auckland, Wellington, Christchurch and Queenstown."}' \
            '{"title":"England 2024","slug":"england-2024"}' '{"title":"Christmas","slug":"christmas"}'; do
  curl -fsS -X POST "${H[@]}" -d "$body" $A/api/collections >/dev/null
done
NZ_IDS=$(curl -fsS "${H[@]}" $A/api/photos | json 'JSON.stringify(d.filter(p=>p.gpsPlace?.countryCode==="NZ").slice(0,6).map(p=>p.id))')
NZ=$(curl -fsS "${H[@]}" $A/api/collections | json 'd.find(c=>c.slug==="new-zealand-2025").id')
curl -fsS -X POST "${H[@]}" -d "{\"ids\":$NZ_IDS,\"addTo\":\"$NZ\"}" $A/api/photos/bulk >/dev/null
# Four featured photos for the "Featured photography" section.
FEAT=$(curl -fsS "${H[@]}" $A/api/photos | json 'JSON.stringify(d.slice(-4).map(p=>p.id))')
curl -fsS -X POST "${H[@]}" -d "{\"ids\":$FEAT,\"set\":{\"featured\":true}}" $A/api/photos/bulk >/dev/null
export PHOTO_ID=$(curl -fsS http://127.0.0.1:8088/api/photos | json 'd[0].id')

status=0
node test/ui/public-check.cjs || status=1
node test/ui/admin-check.cjs || status=1
exit $status
