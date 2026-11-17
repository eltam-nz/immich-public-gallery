#!/usr/bin/env bash
# End-to-end test: real stack + mock Immich. Requires Docker and `pnpm install`.
# MOCK_IMMICH_MODE=current (default) mimics current Immich (album assets via the
# timeline API); MOCK_IMMICH_MODE=legacy mimics older Immich (assets in the album).
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=immich-showcase
export DB_OWNER_PASSWORD=owner-test-pw PUBLIC_DB_PASSWORD=public-test-pw ADMIN_DB_PASSWORD=admin-test-pw
export PUBLIC_ID_SECRET=test-secret-test-secret-test-secret-123
export IMMICH_NETWORK=showcase_test_immich
export MOCK_IMMICH_MODE=${MOCK_IMMICH_MODE:-current}
# Bind-mounted data goes to a throwaway folder, never /srv/docker.
export DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/showcase-e2e.XXXXXX")
echo "mock Immich mode: $MOCK_IMMICH_MODE"
export SHARED_LINK_KEYS=test-shared-link-key SYNC_INTERVAL_MINUTES=60 SITE_TITLE="E2E Photos"
DC="docker compose -f docker-compose.yml -f docker-compose.test.yml"

node test/mock-immich/make-fixtures.mjs >/dev/null
docker network inspect "$IMMICH_NETWORK" >/dev/null 2>&1 || docker network create "$IMMICH_NETWORK" >/dev/null
$DC down -v --remove-orphans >/dev/null 2>&1 || true
$DC up -d ${E2E_NO_BUILD:+--no-build}
cleanup() {
  [ "${KEEP:-}" ] && { echo "kept stack; data in $DATA_DIR"; return; }
  $DC down -v >/dev/null 2>&1
  # Files are owned by container users (postgres, node), so remove them from a container.
  docker run --rm -v "$DATA_DIR:/d" postgres:16-alpine sh -c 'rm -rf /d/* /d/.[!.]*' >/dev/null 2>&1
  rmdir "$DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

WEB=http://127.0.0.1:8088
fail() { echo "FAIL: $*"; $DC logs public-api | tail -30; exit 1; }
pass() { echo "ok   $*"; }
count() { curl -fsS $WEB/api/photos 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch{console.log(-1)}})' || echo -1; }

for i in $(seq 1 60); do
  n=$(count)
  [ "$n" = 3 ] && break; sleep 1
done
[ "$n" = 3 ] || fail "expected 3 photos (videos excluded), got $n"
pass "sync: 3 images published, video skipped"

# Data lives in bind mounts under DATA_DIR (stat works without read access to the folders).
[ "$(stat -c %u "$DATA_DIR/postgres")" = 70 ] || fail "postgres data not in $DATA_DIR/postgres"
[ "$(stat -c %u "$DATA_DIR/cache")" = 1000 ] || fail "cache folder not owned by uid 1000"
[ -n "$(ls -A "$DATA_DIR/cache")" ] || fail "image cache not written to $DATA_DIR/cache"
pass "database and image cache live in bind mounts under DATA_DIR"

body=$(curl -fsS $WEB/api/photos)
echo "$body" | grep -qiE 'immich|SHOULD-NOT-LEAK|serial|fileSize|test-shared-link-key|aaaaaaaa-' && fail "internal data leaked: $body"
pass "no Immich IDs, keys, serials or non-allowlisted fields in API"
echo "$body" | grep -q '"lat"' && fail "GPS exposed with DEFAULT_GPS_PRECISION=-1"
echo "$body" | grep -q '"city":"London"' || fail "expected allowlisted city"
pass "coordinates hidden by default, place names kept"

thumb=$(echo "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].src.thumb))')
curl -fsS -o /tmp/e2e-thumb.webp $WEB$thumb || fail "image not served"
node -e '
const exifr=require("exifr"); const fs=require("fs");
const b=fs.readFileSync("/tmp/e2e-thumb.webp");
if (b.includes("SECRET-OWNER")||b.includes("Canon")) { console.error("metadata bytes present"); process.exit(1); }
exifr.parse(b,{gps:true,xmp:true,iptc:true}).then(x=>{ if(x&&Object.keys(x).length){console.error(JSON.stringify(x));process.exit(1)} })
  .catch(()=>{});' || fail "served image still has metadata"
pass "served images contain no EXIF/GPS/XMP"

hdr=$(curl -fsSI $WEB$thumb)
echo "$hdr" | grep -qi 'cache-control: public, max-age=31536000, immutable' || fail "missing immutable cache header"
curl -fsSI $WEB/ | grep -qi "content-security-policy: default-src 'none'" || fail "missing CSP"
pass "security + cache headers present"

[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST $WEB/api/photos)" = 405 ] || fail "POST not rejected"
for p in "/img/../../etc/passwd" "/img/%2e%2e/%2e%2e/etc/passwd" "/img/x/..%2f..%2f..%2fetc%2fpasswd/thumb.webp"; do
  curl -s --path-as-is "$WEB$p" | grep -q "root:" && fail "path traversal via $p"
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB/img/AAAAAAAAAAAAAAAA/000000000000/thumb.webp")" = 404 ] || fail "unknown image served"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB/api/shared-links/me?key=test-shared-link-key")" = 404 ] || fail "API proxies to Immich"
pass "read-only, no traversal, no passthrough to Immich"

calls=$(curl -fsS http://127.0.0.1:2283/__control/requests)
echo "$calls" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const ok=[/^GET \/api\/shared-links\/me$/,/^GET \/api\/albums\/[0-9a-f-]{36}$/,/^GET \/api\/assets\/[0-9a-f-]{36}\/thumbnail\?size=preview$/,
    /^GET \/api\/timeline\/buckets$/,/^GET \/api\/timeline\/bucket$/,/^GET \/api\/assets\/[0-9a-f-]{36}$/,/^GET \/api\/server\/version$/];
  const bad=JSON.parse(s).filter(r=>!ok.some(re=>re.test(r)));
  if(bad.length){console.error("unexpected Immich calls:",bad);process.exit(1)}})' || fail "public-api called non-allowlisted Immich endpoints"
pass "public-api only called allowlisted Immich endpoints"

# ---------------- Admin app ----------------
ADMIN=http://127.0.0.1:8089
MOCK=http://127.0.0.1:2283
jq_() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log($1)})"; }
token() { curl -fsS "$MOCK/__control/sign?$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
TOKEN=$(token "email=admin@example.com")
AUTH=(-H "Cf-Access-Jwt-Assertion: $TOKEN")
W=(-H "x-showcase-admin: 1" -H "content-type: application/json")
for i in $(seq 1 30); do [ "$(code "${AUTH[@]}" $ADMIN/api/status)" = 200 ] && break; sleep 1; done

[ "$(code $ADMIN/)" = 401 ] || fail "admin UI reachable without Access token"
[ "$(code $ADMIN/api/status)" = 401 ] || fail "admin API reachable without Access token"
[ "$(code -H "Cf-Access-Jwt-Assertion: $(token "email=admin@example.com&aud=other-app")" $ADMIN/api/status)" = 401 ] || fail "wrong audience accepted"
[ "$(code -H "Cf-Access-Jwt-Assertion: $(token "email=admin@example.com&exp=-600")" $ADMIN/api/status)" = 401 ] || fail "expired token accepted"
[ "$(code -H "Cf-Access-Jwt-Assertion: $(token "email=intruder@example.com")" $ADMIN/api/status)" = 403 ] || fail "non-admin email accepted"
curl -fsS "${AUTH[@]}" $ADMIN/api/status | grep -q '"email":"admin@example.com"' || fail "admin status"
curl -fsS "${AUTH[@]}" $ADMIN/ | grep -q '<div id="app">' || fail "admin UI not served"
pass "admin: Cloudflare Access token required (audience, expiry, email checked)"

[ "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{}' $ADMIN/api/sync)" = 403 ] || fail "mutation without CSRF header accepted"
[ "$(code -X POST "${AUTH[@]}" "${W[@]}" -H 'sec-fetch-site: cross-site' -d '{}' $ADMIN/api/sync)" = 403 ] || fail "cross-site mutation accepted"
pass "admin: changes need the CSRF header and a same-origin request"

ids=$(curl -fsS "${AUTH[@]}" $ADMIN/api/photos | jq_ 'd.map(p=>p.id).join(" ")')
read -r P1 P2 P3 <<<"$ids"
[ -n "$P3" ] || fail "admin photo list: $ids"
COLL=$(curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d '{"title":"Holiday","slug":"holiday","description":"Trip"}' $ADMIN/api/collections | jq_ 'd.id')
[ -n "$COLL" ] || fail "create collection"
[ "$(code -X POST "${AUTH[@]}" "${W[@]}" -d '{"title":"Dup","slug":"holiday"}' $ADMIN/api/collections)" = 409 ] || fail "duplicate slug not rejected"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P1\",\"$P2\"],\"addTo\":\"$COLL\"}" $ADMIN/api/photos/bulk >/dev/null || fail "add to collection"
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"caption":"Hello world","tags":["sea"," sea ","sky"],"gpsPrecision":2}' $ADMIN/api/photos/$P1 | grep -q '"tags":\["sea","sky"\]' || fail "edit photo"
[ "$(code -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"immich_asset_id":"x"}' $ADMIN/api/photos/$P1)" = 400 ] || fail "unknown field accepted"

pub=$(curl -fsS $WEB/api/collections)
echo "$pub" | grep -q '"slug":"holiday"' && echo "$pub" | grep -q '"count":2' && echo "$pub" | grep -q '"cover":"/img/' || fail "public collections: $pub"
[ "$(curl -fsS "$WEB/api/photos?collection=holiday" | jq_ 'd.length')" = 2 ] || fail "public collection filter"
p1=$(curl -fsS $WEB/api/photos/$P1)
echo "$p1" | grep -q '"caption":"Hello world"' && echo "$p1" | grep -q '"lat":51.5' && echo "$p1" | grep -q '"title":"Holiday"' || fail "public photo edits: $p1"
pass "admin: collections, captions, tags and GPS precision reach the public site"

P2_THUMB=$(curl -fsS $WEB/api/photos/$P2 | jq_ 'd.src.thumb')
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\"],\"set\":{\"visible\":false}}" $ADMIN/api/photos/bulk >/dev/null
[ "$(count)" = 2 ] || fail "hidden photo still listed publicly"
[ "$(code $WEB$P2_THUMB)" = 404 ] || fail "hidden photo image still served publicly"
[ "$(code "${AUTH[@]}" $ADMIN$P2_THUMB)" = 200 ] || fail "admin cannot see hidden photo"
curl -fsS "$WEB/api/collections" | grep -q '"count":1' || fail "collection count ignores hidden photo"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\"],\"set\":{\"visible\":true}}" $ADMIN/api/photos/bulk >/dev/null
[ "$(count)" = 3 ] || fail "unhidden photo not back"
pass "admin: hiding a photo removes it (and its image) from the public site"

before=$(curl -fsS $MOCK/__control/requests | grep -o 'shared-links/me' | wc -l)
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d '{}' $ADMIN/api/sync >/dev/null || fail "sync request"
for i in $(seq 1 20); do after=$(curl -fsS $MOCK/__control/requests | grep -o 'shared-links/me' | wc -l); [ "$after" -gt "$before" ] && break; sleep 1; done
[ "$after" -gt "$before" ] || fail "Sync now did not trigger a sync"
pass "admin: Sync now triggers an immediate sync"

[ "$(code -X DELETE "${AUTH[@]}" -H "x-showcase-admin: 1" $ADMIN/api/collections/$COLL)" = 204 ] || fail "delete collection"
curl -fsS $WEB/api/collections | grep -q holiday && fail "deleted collection still public"
pass "admin: deleting a collection keeps its photos"

out=$($DC exec -T -e PGPASSWORD="$ADMIN_DB_PASSWORD" db psql -U showcase_admin -d showcase -h 127.0.0.1 -c "UPDATE assets SET width = 1" 2>&1 || true)
echo "$out" | grep -q "permission denied" || fail "admin role can write synced assets: $out"
out=$($DC exec -T -e PGPASSWORD="$PUBLIC_DB_PASSWORD" db psql -U showcase_public -d showcase -h 127.0.0.1 -c "DELETE FROM collections" 2>&1 || true)
echo "$out" | grep -q "permission denied" || fail "public role can write collections: $out"
pass "admin DB role cannot touch synced data; public role cannot touch collections"

if [ "$MOCK_IMMICH_MODE" = current ]; then
  echo "$calls" | grep -q '/api/timeline/bucket' || fail "current mode did not use the timeline API"
  pass "current Immich: album listed via timeline API"
  # One asset's detail returns 404 -> only that asset is dropped, the site is not wiped.
  curl -fsS http://127.0.0.1:2283/__control/detail-404 >/dev/null
  $DC restart public-api >/dev/null
  for i in $(seq 1 30); do n=$(count); [ "$n" = 2 ] && break; sleep 1; done
  [ "$n" = 2 ] || fail "expected 2 photos after one asset 404s, got $n"
  pass "a single unavailable asset is dropped without unpublishing the album"
  expect_after_remove=1
else
  echo "$calls" | grep -q '/api/timeline/' && fail "legacy mode should not need the timeline API"
  pass "legacy Immich: assets read from the album response"
  expect_after_remove=2
fi

# Photo removed from the album -> disappears after re-sync.
curl -fsS http://127.0.0.1:2283/__control/remove-one >/dev/null
$DC restart public-api >/dev/null
for i in $(seq 1 30); do n=$(count); [ "$n" = "$expect_after_remove" ] && break; sleep 1; done
[ "$n" = "$expect_after_remove" ] || fail "removed photo still published ($n)"
pass "photo removed from Immich album is unpublished"

if [ "$MOCK_IMMICH_MODE" = current ]; then
  # Immich reports assets but none can be parsed -> warn, and keep what is published.
  curl -fsS http://127.0.0.1:2283/__control/break-timeline >/dev/null
  $DC restart public-api >/dev/null
  for i in $(seq 1 30); do $DC logs public-api 2>/dev/null | grep -q "none were parsed" && break; sleep 1; done
  $DC logs public-api 2>/dev/null | grep -q "none were parsed" || fail "no warning when Immich reports assets but none parse"
  [ "$(count)" = "$expect_after_remove" ] || fail "site was wiped after a parse failure"
  pass "parse failure warns and keeps published photos"
fi

# Link revoked -> site empties.
curl -fsS http://127.0.0.1:2283/__control/revoke >/dev/null
$DC restart public-api >/dev/null
for i in $(seq 1 30); do n=$(count); [ "$n" = 0 ] && break; sleep 1; done
[ "$n" = 0 ] || fail "revoked link still published ($n)"
pass "revoked shared link unpublishes everything"

# Least privilege: the public DB role cannot touch admin tables.
out=$($DC exec -T -e PGPASSWORD="$PUBLIC_DB_PASSWORD" db psql -U showcase_public -d showcase -h 127.0.0.1 -c "UPDATE photos_meta SET visible=false" 2>&1 || true)
echo "$out" | grep -q "permission denied" || fail "public role can write admin tables: $out"
pass "public DB role is read-only on admin tables"

# Isolation: edge/backend are internal, and the bundled tunnel is off without its profile.
for net in edge backend; do
  [ "$(docker network inspect -f '{{.Internal}}' "${COMPOSE_PROJECT_NAME}_$net")" = true ] || fail "$net network is not internal"
done
[ -z "$($DC ps -q cloudflared 2>/dev/null)" ] || fail "cloudflared started without the bundled-tunnel profile"
pass "edge/backend networks internal; cloudflared off without profile"

echo "ALL E2E CHECKS PASSED"
