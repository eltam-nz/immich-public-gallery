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
export BACKUP_KEEP=2
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
echo "$body" | grep -qE '"(lat|lon|latitude|longitude)"|51\.50|0\.124' && fail "photo coordinates published: $body"
echo "$body" | grep -q '"location":{"placeId":"g[0-9]*","name":"London","country":"United Kingdom"}' || fail "expected city-level place London: $body"
echo "$body" | grep -qE '"state"|"England"|"city"' && fail "Immich's own place fields published"
pass "only the nearest city is published (London), never coordinates"

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
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"caption":"Hello world","tags":["sea"," sea ","sky"]}' $ADMIN/api/photos/$P1 | grep -q '"tags":\["sea","sky"\]' || fail "edit photo"
[ "$(code -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"immich_asset_id":"x"}' $ADMIN/api/photos/$P1)" = 400 ] || fail "unknown field accepted"

pub=$(curl -fsS $WEB/api/collections)
echo "$pub" | grep -q '"slug":"holiday"' && echo "$pub" | grep -q '"count":2' || fail "public collections: $pub"
# Cover tiles: 1-4 thumbnails, all from photos in the collection.
H_IDS=$(curl -fsS "$WEB/api/photos?collection=holiday" | jq_ 'd.map(p=>p.id).join(",")')
echo "$pub" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const c=JSON.parse(s).find(x=>x.slug==="holiday"); const ids=process.argv[1].split(",");
    const ok=c && Array.isArray(c.covers) && c.covers.length>=1 && c.covers.length<=4 &&
      c.covers.every(u=>/^\/img\/[A-Za-z0-9_-]{16}\/[a-f0-9]{12}\/thumb\.webp$/.test(u) && ids.includes(u.split("/")[2])) &&
      new Set(c.covers).size===c.covers.length && !("cover" in c);
    if(!ok){console.error(JSON.stringify(c));process.exit(1)}})' "$H_IDS" || fail "collection cover tiles"
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d "{\"coverPhotoId\":\"$P2\"}" $ADMIN/api/collections/$COLL >/dev/null
curl -fsS $WEB/api/collections | jq_ 'd.find(x=>x.slug==="holiday").covers[0].split("/")[2]' | grep -qx "$P2" || fail "chosen cover not first"
[ "$(curl -fsS "$WEB/api/places?collection=holiday" | jq_ 'd.reduce((n,p)=>n+p.count,0)')" = 2 ] || fail "places filtered by collection"
[ "$(code "$WEB/api/places?collection=../x")" = 400 ] || fail "bad collection id accepted by places"
pass "collections: up to 4 cover tiles from the collection (chosen cover first); places per collection"
C2=$(curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d '{"title":"Zebra","slug":"zebra"}' $ADMIN/api/collections | jq_ 'd.id')
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P3\"],\"addTo\":\"$C2\"}" $ADMIN/api/photos/bulk >/dev/null
curl -fsS -X PUT "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$C2\",\"$COLL\"]}" $ADMIN/api/collections/order >/dev/null || fail "order collections"
[ "$(curl -fsS $WEB/api/collections | jq_ 'd.map(c=>c.slug).join(",")')" = "zebra,holiday" ] || fail "collection order not applied"
[ "$(code -X PUT "${AUTH[@]}" "${W[@]}" -d '{"ids":["../x"]}' $ADMIN/api/collections/order)" = 400 ] || fail "bad order body accepted"
curl -fsS -X DELETE "${AUTH[@]}" -H "x-showcase-admin: 1" $ADMIN/api/collections/$C2 >/dev/null
pass "collections: reorder saves the whole order at once"
# Featured photography: photos ticked Featured, with tiles and a date range.
[ "$(curl -fsS $WEB/api/featured | jq_ 'd.count')" = 0 ] || fail "featured not empty at start"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P1\",\"$P2\"],\"set\":{\"featured\":true}}" $ADMIN/api/photos/bulk >/dev/null
feat=$(curl -fsS $WEB/api/featured)
echo "$feat" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s);const ids=process.argv.slice(1);
  const ok=f.count===2 && f.covers.length===2 && f.covers.every(u=>ids.includes(u.split("/")[2])) && f.dateRange && /^\d{4}-\d{2}-\d{2}$/.test(f.dateRange.from);
  if(!ok){console.error(s);process.exit(1)}})' "$P1" "$P2" || fail "featured summary: $feat"
[ "$(curl -fsS "$WEB/api/photos?featured=1" | jq_ 'd.length')" = 2 ] || fail "featured photos list"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\"],\"set\":{\"visible\":false}}" $ADMIN/api/photos/bulk >/dev/null
[ "$(curl -fsS $WEB/api/featured | jq_ 'd.count')" = 1 ] || fail "hidden photo counted as featured"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P1\",\"$P2\"],\"set\":{\"featured\":false,\"visible\":true}}" $ADMIN/api/photos/bulk >/dev/null
curl -fsS $WEB/api/collections | jq_ 'd.find(c=>c.slug==="holiday").dateRange.from' | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || fail "collection date range"
pass "featured photography: only featured, visible photos; collections have date ranges"

# Copy one caption to a group (bulk), then clear it.
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\",\"$P3\"],\"set\":{\"caption\":\"  Shared caption  \"}}" $ADMIN/api/photos/bulk >/dev/null
[ "$(curl -fsS "$WEB/api/photos" | jq_ 'd.filter(p=>p.caption==="Shared caption").length')" = 2 ] || fail "bulk caption"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\",\"$P3\"],\"set\":{\"caption\":\"\"}}" $ADMIN/api/photos/bulk >/dev/null
[ "$(curl -fsS "$WEB/api/photos" | jq_ 'd.filter(p=>p.caption==="Shared caption").length')" = 0 ] || fail "bulk caption clear"
pass "captions: one caption copied to a group, and cleared"
[ "$(curl -fsS "$WEB/api/photos?collection=holiday" | jq_ 'd.length')" = 2 ] || fail "public collection filter"
p1=$(curl -fsS $WEB/api/photos/$P1)
echo "$p1" | grep -q '"caption":"Hello world"' && echo "$p1" | grep -q '"title":"Holiday"' || fail "public photo edits: $p1"
pass "admin: collections, captions and tags reach the public site"

# ---- Places ----
places() { curl -fsS $WEB/api/places; }
pl=$(places)
[ "$(echo "$pl" | jq_ 'd.length')" = 1 ] && echo "$pl" | grep -q '"name":"London"' && echo "$pl" | grep -q '"count":3' || fail "public places: $pl"
LONDON=$(echo "$pl" | jq_ 'd[0].id')
[ "$(curl -fsS "$WEB/api/photos?place=$LONDON" | jq_ 'd.length')" = 3 ] || fail "photos by place"
[ "$(code "$WEB/api/photos?place=../etc")" = 400 ] || fail "bad place id accepted"
BATH=$(curl -fsS "${AUTH[@]}" "$ADMIN/api/places/search?q=bath" | jq_ 'd[0].countryCode==="GB" ? d[0].id : ""')
[ -n "$BATH" ] || fail "place search did not find Bath, GB"
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d "{\"location\":{\"mode\":\"place\",\"placeId\":\"$BATH\"}}" $ADMIN/api/photos/$P1 | grep -q '"locationMode":"place"' || fail "set place"
pl=$(places)
[ "$(echo "$pl" | jq_ 'd.length')" = 2 ] && echo "$pl" | grep -q '"name":"Bath"' || fail "public places after setting Bath: $pl"
pass "places: GPS snaps to the city; a chosen place (search) shows on the map"

# Copy one photo's place to others (bulk), then hide one, then back to GPS.
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P2\",\"$P3\"],\"location\":{\"mode\":\"place\",\"placeId\":\"$BATH\"}}" $ADMIN/api/photos/bulk >/dev/null || fail "bulk place"
[ "$(curl -fsS "$WEB/api/photos?place=$BATH" | jq_ 'd.length')" = 3 ] || fail "bulk-applied place"
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"location":{"mode":"hidden"}}' $ADMIN/api/photos/$P3 >/dev/null
curl -fsS $WEB/api/photos/$P3 | grep -q '"location":null' || fail "hidden location still published"
[ "$(curl -fsS "$WEB/api/photos?place=$BATH" | jq_ 'd.length')" = 2 ] || fail "hidden photo still counted at place"
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P1\",\"$P2\",\"$P3\"],\"location\":{\"mode\":\"auto\"}}" $ADMIN/api/photos/bulk >/dev/null
pl=$(places)
[ "$(echo "$pl" | jq_ 'd.length')" = 1 ] && echo "$pl" | grep -q '"count":3' || fail "back to GPS: $pl"
pass "places: apply a place to selected photos, hide a location, return to GPS"

[ "$(code -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"location":{"mode":"place","placeId":"g999999999"}}' $ADMIN/api/photos/$P1)" = 400 ] || fail "unknown place accepted"
[ "$(code -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"location":{"mode":"place","placeId":"'$BATH'","name":"Evil","lat":1}}' $ADMIN/api/photos/$P1)" = 400 ] || fail "forged place fields accepted"
pass "places: unknown or forged places are rejected"

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

# ---------------- Backups ----------------
BK="$DATA_DIR/backups"
dumps() { ls -1t "$BK"/showcase-*.dump 2>/dev/null; }
for i in $(seq 1 30); do [ -n "$(dumps)" ] && break; sleep 1; done
[ -n "$(dumps)" ] || fail "no automatic backup at startup: $($DC logs backup | tail -5)"
$DC exec -T backup backup.sh once >/dev/null || fail "backup.sh once"
sleep 1
$DC exec -T backup backup.sh once >/dev/null || fail "backup.sh once (2)"
[ "$(dumps | wc -l)" = 2 ] || fail "retention: expected 2 dumps with BACKUP_KEEP=2, got: $(dumps)"
[ "$(stat -c %u "$BK" "$(dumps | head -1)" | sort -u)" = 1000 ] || fail "backups not owned by uid 1000"
# Capture first: grep -q exiting early would break the pipe and, with pipefail, fail the check.
TOC=$($DC exec -T backup pg_restore --list "/backups/$(basename "$(dumps | head -1)")")
grep -q "TABLE DATA public collections" <<<"$TOC" || fail "dump missing collections data"
$DC exec -T backup backup.sh check || fail "backup healthcheck"
ls "$BK" | grep -q '\.tmp$' && fail "temp file left behind"
pass "backups: automatic + on demand, verified, pruned to BACKUP_KEEP, owned by uid 1000"

# Restore round-trip: back up, change things, restore, check they're back.
CB=$(curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d '{"title":"Backup test","slug":"backup-test"}' $ADMIN/api/collections | jq_ 'd.id')
curl -fsS -X POST "${AUTH[@]}" "${W[@]}" -d "{\"ids\":[\"$P3\"],\"addTo\":\"$CB\"}" $ADMIN/api/photos/bulk >/dev/null
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"caption":"Before backup"}' $ADMIN/api/photos/$P3 >/dev/null
$DC exec -T backup backup.sh once >/dev/null || fail "backup before restore"
DUMP=$(dumps | head -1)
curl -fsS -X DELETE "${AUTH[@]}" -H "x-showcase-admin: 1" $ADMIN/api/collections/$CB >/dev/null
curl -fsS -X PATCH "${AUTH[@]}" "${W[@]}" -d '{"caption":"After backup"}' $ADMIN/api/photos/$P3 >/dev/null
curl -fsS $WEB/api/collections | grep -q backup-test && fail "collection not deleted before restore"
$DC stop admin-app public-api >/dev/null 2>&1
$DC exec -T db pg_restore -U showcase_owner -d showcase --clean --if-exists < "$DUMP" || fail "pg_restore"
$DC start public-api admin-app >/dev/null 2>&1
for i in $(seq 1 30); do curl -fsS $WEB/api/collections 2>/dev/null | grep -q backup-test && break; sleep 1; done
curl -fsS $WEB/api/collections | grep -q '"slug":"backup-test"' || fail "collection not restored: api=$(curl -sS $WEB/api/collections) db=$($DC exec -T db psql -U showcase_owner -d showcase -tAc "select (select count(*) from collections where slug='backup-test'), (select count(*) from collection_photos), (select count(*) from assets where cached_version is not null)") restore-log=$($DC logs --since 2m public-api 2>&1 | grep -E 'sync|error' | tail -3)"
curl -fsS $WEB/api/photos/$P3 | grep -q '"caption":"Before backup"' || fail "caption not restored"
for i in $(seq 1 30); do [ "$(code "${AUTH[@]}" $ADMIN/api/status)" = 200 ] && break; sleep 1; done
[ "$(code "${AUTH[@]}" $ADMIN/api/status)" = 200 ] || fail "admin not working after restore"
pass "restore from backup brings back collections and captions"

# public-api recreated (new container, possibly new IP): nginx must still reach it.
$DC up -d --no-build --no-deps --force-recreate public-api >/dev/null 2>&1
for i in $(seq 1 30); do [ "$(count)" -ge 1 ] && break; sleep 1; done
[ "$(count)" -ge 1 ] || fail "public site broken after public-api was recreated"
pass "public site keeps working when public-api is recreated"

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
