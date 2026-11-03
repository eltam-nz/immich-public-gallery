#!/usr/bin/env bash
# End-to-end test: real stack + mock Immich. Requires Docker and `pnpm install`.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=immich-showcase
export DB_OWNER_PASSWORD=owner-test-pw PUBLIC_DB_PASSWORD=public-test-pw
export PUBLIC_ID_SECRET=test-secret-test-secret-test-secret-123
export IMMICH_NETWORK=showcase_test_immich
export SHARED_LINK_KEYS=test-shared-link-key SYNC_INTERVAL_MINUTES=60 SITE_TITLE="E2E Photos"
DC="docker compose -f docker-compose.yml -f docker-compose.test.yml"

node test/mock-immich/make-fixtures.mjs >/dev/null
docker network inspect "$IMMICH_NETWORK" >/dev/null 2>&1 || docker network create "$IMMICH_NETWORK" >/dev/null
$DC down -v --remove-orphans >/dev/null 2>&1 || true
$DC up -d ${E2E_NO_BUILD:+--no-build}
trap '[ "${KEEP:-}" ] || $DC down -v >/dev/null 2>&1' EXIT

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
  const ok=[/^GET \/api\/shared-links\/me$/,/^GET \/api\/albums\/[0-9a-f-]{36}$/,/^GET \/api\/assets\/[0-9a-f-]{36}\/thumbnail\?size=preview$/];
  const bad=JSON.parse(s).filter(r=>!ok.some(re=>re.test(r)));
  if(bad.length){console.error("unexpected Immich calls:",bad);process.exit(1)}})' || fail "public-api called non-allowlisted Immich endpoints"
pass "public-api only called allowlisted Immich endpoints"

# Photo removed from the album -> disappears after re-sync.
curl -fsS http://127.0.0.1:2283/__control/remove-one >/dev/null
$DC restart public-api >/dev/null
for i in $(seq 1 30); do n=$(count); [ "$n" = 2 ] && break; sleep 1; done
[ "$n" = 2 ] || fail "removed photo still published ($n)"
pass "photo removed from Immich album is unpublished"

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
