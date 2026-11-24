// UI checks for the public site: screenshots, axe accessibility scan,
// tap-target sizes, 200% text with no sideways scrolling, console/CSP errors.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

// Run via test/ui/run.sh, which starts a seeded stack and sets these.
const OUT = process.env.OUT || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const WEB = process.env.WEB || 'http://127.0.0.1:8088';
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const PID = process.env.PHOTO_ID; // any published photo id, for the viewer page

const pages = [
  ['home', '/'],
  ['collection', '/?c=new-zealand-2025'],
  ['all', '/?view=all'],
  ['map', '/?view=map'],
  ['featured', '/?view=featured'],
  ['viewer', `/?view=all&p=${PID}`],
];
const sizes = [
  ['se', { viewport: { width: 375, height: 667 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['iphone13', devices['iPhone 13']],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
];

const problems = [];
const note = (s) => { problems.push(s); };

(async () => {
  const b = await chromium.launch();
  for (const [sizeName, opts] of sizes) {
    const ctx = await b.newContext({ ...opts });
    for (const [name, url] of pages) {
      const p = await ctx.newPage();
      const errs = [];
      p.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/tile\.openstreetmap\.org|ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(t)) return; // tiles blocked in sandbox
        errs.push(t);
      });
      p.on('pageerror', (e) => errs.push(String(e)));
      await p.goto(WEB + url, { waitUntil: 'networkidle' });
      await p.waitForTimeout(name === 'map' ? 800 : 300);
      await p.screenshot({ path: `${OUT}/${sizeName}-${name}.png`, fullPage: name !== 'viewer' });
      if (errs.length) note(`${sizeName}/${name}: console errors: ${errs.join(' | ')}`);

      // Horizontal overflow
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) note(`${sizeName}/${name}: horizontal overflow ${overflow}px`);

      // Tap targets (phones only): every visible button/link >= 44x44, except inline text links.
      if (sizeName !== 'desktop') {
        const small = await p.evaluate(() =>
          [...document.querySelectorAll('a, button')]
            .filter((e) => e.offsetParent !== null || e.closest('dialog[open]'))
            .filter((e) => !e.closest('.leaflet-control-attribution') && !e.classList.contains('visually-hidden'))
            .map((e) => ({ e, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
            .map(({ e, r }) => `${e.tagName.toLowerCase()}"${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`),
        );
        if (small.length) note(`${sizeName}/${name}: small tap targets: ${small.join('; ')}`);
      }
      await p.close();
    }
    await ctx.close();
  }

  // Accessibility scan (axe), with CSP bypassed only so the test can inject axe.
  const actx = await b.newContext({ ...devices['iPhone 13'], bypassCSP: true });
  for (const [name, url] of pages) {
    const p = await actx.newPage();
    await p.goto(WEB + url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(async () => {
      const r = await window.axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, t: v.nodes[0]?.target?.join(' ') }));
    });
    for (const v of res) {
      const line = `axe ${name}: [${v.impact}] ${v.id} (${v.n}) ${v.help} @ ${v.t}`;
      if (v.impact === 'serious' || v.impact === 'critical') note(line);
      else console.log('minor:', line);
    }
    await p.close();
  }
  await actx.close();

  // The small collection map must not move when dragged, swiped or scrolled over.
  {
    const ctx = await b.newContext(devices['iPhone 13']);
    const p = await ctx.newPage();
    await p.goto(WEB + '/?c=new-zealand-2025', { waitUntil: 'networkidle' });
    const map = p.locator('figure.where .map');
    await map.waitFor();
    await p.waitForTimeout(500);
    const pos = () => p.evaluate(() => {
      const pane = document.querySelector('figure.where .leaflet-map-pane');
      return pane ? getComputedStyle(pane).transform : 'none';
    });
    const before = await pos();
    const box = await map.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // mouse drag
    await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx - 120, cy + 40, { steps: 8 }); await p.mouse.up();
    // wheel + double tap
    await p.mouse.wheel(0, -300);
    await map.dblclick();
    await p.waitForTimeout(400);
    const after = await pos();
    const zoomCtl = await p.locator('figure.where .leaflet-control-zoom').count();
    if (before !== after) note(`collection map moved: ${before} -> ${after}`);
    if (zoomCtl) note('collection map shows zoom buttons');
    const caption = await p.locator('figure.where figcaption').innerText();
    if (!/Taken in:[\s\S]*Auckland/.test(caption)) note(`collection map caption: ${caption}`);
    await ctx.close();
  }

  // 200% text size on a small phone: no sideways scrolling.
  const zctx = await b.newContext(sizes[0][1]);
  for (const [name, url] of pages) {
    const p = await zctx.newPage();
    await p.goto(WEB + url, { waitUntil: 'networkidle' });
    await p.addStyleTag({ content: 'html { font-size: 225% !important; }' }).catch(() => {});
    await p.evaluate(() => { document.documentElement.style.fontSize = '225%'; });
    await p.waitForTimeout(300);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: `${OUT}/zoom200-${name}.png` });
    if (overflow > 1) note(`zoom200/${name}: horizontal overflow ${overflow}px`);
    await p.close();
  }
  await zctx.close();
  await b.close();

  console.log(problems.length ? `PROBLEMS (${problems.length}):\n- ${problems.join('\n- ')}` : 'ALL UI CHECKS PASSED');
  process.exitCode = problems.length ? 1 : 0;
})();
