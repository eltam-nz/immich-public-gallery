// Mobile/desktop checks for the admin app: screenshots, layout, tap targets,
// input font sizes, axe, console errors, and the main phone workflows.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

// Run via test/ui/run.sh, which starts a seeded stack and sets these.
const OUT = process.env.OUT || path.join(__dirname, 'admin-shots');
fs.mkdirSync(OUT, { recursive: true });
const A = process.env.ADMIN || 'http://127.0.0.1:8089';
const TOKEN = process.env.ACCESS_TOKEN; // a test Cloudflare Access token from the mock
const AXE = fs.readFileSync(process.env.AXE_PATH || require.resolve('axe-core/axe.min.js'), 'utf8');
const H = { 'Cf-Access-Jwt-Assertion': TOKEN };
const problems = [];
const note = (s) => problems.push(s);

const sizes = [
  ['se', { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }],
  ['iphone13', devices['iPhone 13']],
  ['desktop', { viewport: { width: 1280, height: 850 } }],
];

async function api(ctx, p) {
  const r = await ctx.request.get(A + p, { headers: H });
  return r.json();
}

async function audit(page, label, phone) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) note(`${label}: horizontal overflow ${overflow}px`);
  const small = await page.evaluate((phone) => {
    const out = [];
    const visible = (e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' &&
        !e.closest('.visually-hidden') && r.bottom > 0 && r.top < innerHeight;
    };
    for (const e of document.querySelectorAll('a, button, input, select, textarea')) {
      if (!visible(e)) continue;
      // In a modal, only check the modal's contents.
      const modal = document.querySelector('dialog[open]');
      if (modal && !modal.contains(e)) continue;
      const r = e.getBoundingClientRect();
      if (['input', 'select', 'textarea'].includes(e.tagName.toLowerCase()) && e.type !== 'checkbox') {
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 16) out.push(`font ${e.tagName.toLowerCase()} ${fs}px`);
      }
      if (!phone) continue;
      let target = r;
      if (e.type === 'checkbox' && e.closest('label')) target = e.closest('label').getBoundingClientRect();
      if (target.height < 43.5 || target.width < 43.5) {
        out.push(`${e.tagName.toLowerCase()}"${(e.textContent || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 25)}" ${Math.round(target.width)}x${Math.round(target.height)}`);
      }
    }
    return out;
  }, phone);
  if (small.length) note(`${label}: ${small.join('; ')}`);
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id} @ ${v.nodes[0]?.target?.join(' ')}`);
  });
  if (res.length) note(`axe ${label}: ${res.join(' | ')}`);
}

(async () => {
  const b = await chromium.launch();

  // ---- Screens at each size ----
  for (const [size, opts] of sizes) {
    const phone = size !== 'desktop';
    const ctx = await b.newContext({ ...opts, extraHTTPHeaders: H, bypassCSP: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const shot = async (name) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${size}-${name}.png` });
      await audit(page, `${size}/${name}`, phone);
      if (size === 'iphone13' || size === 'desktop') await axe(page, `${size}/${name}`);
    };

    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await shot('photos');

    // Selection + bulk actions
    if (phone) {
      await page.click('button:has-text("Select")');
      const tiles = page.locator('.grid .thumb');
      for (const i of [0, 1, 2]) await tiles.nth(i).click();
      await shot('selecting');
      await page.click('.selbar button:has-text("Actions")');
      await shot('actions-sheet');
      await page.click('dialog button:has-text("Set location…")');
      await page.fill('dialog input[type=search]', 'auck');
      await page.waitForSelector('dialog li button:has-text("Auckland")');
      await shot('place-sheet');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      if (focused !== 'Search places') note(`${size}: place search not focused (${focused})`);
      await page.click('dialog button[aria-label="Close"]'); // back to actions
      await page.waitForSelector('dialog[aria-label$="selected"]');
      await page.click('dialog button[aria-label="Close"]');
      await page.click('.selbar button:has-text("Done")');
    } else {
      const picks = page.locator('.grid .pick');
      await picks.nth(0).check({ force: true });
      await picks.nth(1).check({ force: true });
      await shot('bulk-bar');
      await page.click('.bulk button:has-text("Clear")');
    }

    // Editor
    await page.locator('.grid .thumb').nth(1).click();
    await page.waitForSelector('aside[aria-label="Edit photo"]');
    await shot('editor');
    if (phone) {
      await page.click('aside button:has-text("Choose a place…")');
      await page.waitForSelector('dialog input[type=search]');
      await shot('editor-place');
      await page.click('dialog button[aria-label="Close"]');
    }
    await page.click('aside button[aria-label="Close editor"]');

    // Collections
    await page.goto(A + '/#collections', { waitUntil: 'networkidle' });
    await shot('collections');
    if (phone) {
      await page.locator('button.more').first().click();
      await shot('collection-menu');
      await page.click('dialog button:has-text("Edit details")');
    } else {
      await page.locator('li button:has-text("Edit")').first().click();
    }
    await page.waitForSelector('dialog form#coll-form');
    await shot('collection-edit');
    await page.click('dialog button[aria-label="Close"]');

    // Sync
    await page.goto(A + '/#sync', { waitUntil: 'networkidle' });
    await shot('sync');

    if (errors.length) note(`${size}: console errors: ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---- Phone workflows (iPhone 13) ----
  const ctx = await b.newContext({ ...devices['iPhone 13'], extraHTTPHeaders: H });
  const page = await ctx.newPage();
  // A real page load (goto to the same URL with only a hash change keeps the
  // page's state, e.g. a filter chosen by the previous flow).
  const fresh = async () => {
    await page.goto('about:blank');
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
  };
  const flow = async (name, fn) => {
    try { await fn(); console.log(`ok   flow: ${name}`); } catch (e) { note(`flow ${name}: ${e.message.split('\n')[0]}`); }
  };

  await flow('select 3 photos -> Actions -> add to collection', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.click('button:has-text("Select")');
    const tiles = page.locator('.grid .thumb');
    for (const i of [3, 4, 5]) await tiles.nth(i).click();
    await page.click('.selbar button:has-text("Actions")');
    const cols = await api(ctx, '/api/collections');
    const eng = cols.find((c) => c.slug === 'england-2024');
    await page.selectOption('dialog select', eng.id);
    await page.click('dialog button:has-text("Add")');
    await page.waitForSelector('.toast:has-text("Added to England 2024")');
    const after = (await api(ctx, '/api/collections')).find((c) => c.slug === 'england-2024');
    if (after.count !== 3) throw new Error(`expected 3 in England 2024, got ${after.count}`);
  });

  await flow('editor: next twice, caption, save', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.locator('.grid .thumb').first().click();
    await page.click('aside button[aria-label="Next photo"]');
    await page.click('aside button[aria-label="Next photo"]');
    const pos = await page.locator('aside .pos').innerText();
    if (!/^3 of /.test(pos)) throw new Error(`position ${pos}`);
    const id = location2id(page.url());
    await page.fill('aside textarea', 'Captioned on a phone');
    await page.click('aside footer button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Saved.")');
    const photo = (await api(ctx, '/api/photos')).find((p) => p.id === id);
    if (photo.caption !== 'Captioned on a phone') throw new Error('caption not saved');
  });

  await flow('Back closes the editor', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.locator('.grid .thumb').first().click();
    await page.waitForSelector('aside[aria-label="Edit photo"]');
    await page.goBack();
    await page.waitForSelector('aside[aria-label="Edit photo"]', { state: 'detached', timeout: 3000 });
    if (!page.url().endsWith('#photos')) throw new Error(`url ${page.url()}`);
  });

  await flow('unsaved changes prompt before moving on', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.locator('.grid .thumb').first().click();
    await page.fill('aside textarea', 'unsaved text');
    let asked = false;
    page.once('dialog', (d) => { asked = true; d.dismiss(); });
    await page.click('aside button[aria-label="Next photo"]');
    await page.waitForTimeout(200);
    if (!asked) throw new Error('no confirm shown');
    if (!(await page.locator('aside textarea').inputValue()).includes('unsaved')) throw new Error('moved despite cancel');
    page.once('dialog', (d) => d.accept());
    await page.click('aside button[aria-label="Close editor"]');
  });

  await flow('reorder collections with ↓', async () => {
    await page.goto(A + '/#collections', { waitUntil: 'networkidle' });
    const before = (await api(ctx, '/api/collections')).map((c) => c.title);
    await page.locator(`button[aria-label="Move ${before[0]} down"]`).click();
    await page.waitForSelector('.toast:has-text("Order updated.")');
    const after = (await api(ctx, '/api/collections')).map((c) => c.title);
    if (after[0] !== before[1] || after[1] !== before[0]) throw new Error(`${before} -> ${after}`);
  });

  await flow('bulk set location via picker sheet', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.click('button:has-text("Select")');
    const tiles = page.locator('.grid .thumb');
    for (const i of [0, 1]) await tiles.nth(i).click();
    const ids = await page.evaluate(() => [...document.querySelectorAll('.grid li.selected')].length);
    if (ids !== 2) throw new Error(`selected ${ids}`);
    await page.click('.selbar button:has-text("Actions")');
    await page.click('dialog button:has-text("Set location…")');
    await page.fill('dialog input[type=search]', 'bath');
    await page.locator('dialog li button:has-text("Bath, United Kingdom")').first().click();
    await page.waitForSelector('.toast:has-text("Location set to Bath")');
    const bath = (await api(ctx, '/api/photos')).filter((p) => p.effectivePlace?.name === 'Bath');
    if (bath.length !== 2) throw new Error(`${bath.length} photos at Bath`);
  });

  await flow('sort order saves (number field)', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.locator('.grid .thumb').first().click();
    const id = location2id(page.url());
    await page.fill('aside input[type=number]', '5');
    await page.click('aside footer button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Saved.")');
    if ((await api(ctx, '/api/photos')).find((p) => p.id === id).sort !== 5) throw new Error('sort not saved');
    await page.fill('aside input[type=number]', '');
    await page.click('aside footer button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Saved.")');
    if ((await api(ctx, '/api/photos')).find((p) => p.id === id).sort !== null) throw new Error('sort not cleared');
    await page.click('aside button[aria-label="Close editor"]');
  });

  await flow('Save & next keeps going after a photo leaves the filter', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.selectOption('select.filter', 'none'); // Not in a collection
    await page.locator('.grid .thumb').first().click();
    const first = location2id(page.url());
    const before = await page.locator('aside .pos').innerText();
    await page.locator('aside .colls label:has-text("Christmas") input').check();
    await page.click('aside footer button:has-text("Save & next")');
    await page.waitForFunction((f) => !location.hash.endsWith(f), first);
    const after = await page.locator('aside .pos').innerText();
    if (!/^2 of /.test(after)) throw new Error(`position ${before} -> ${after}`);
    await page.click('aside button[aria-label="Close editor"]');
  });

  await flow('Back asks before discarding unsaved edits', async () => {
    await page.goto(A + '/#photos', { waitUntil: 'networkidle' });
    await page.locator('.grid .thumb').first().click();
    await page.fill('aside textarea', 'not saved yet');
    page.once('dialog', (d) => d.dismiss());
    await page.goBack();
    await page.waitForTimeout(300);
    if (!(await page.locator('aside textarea').count())) throw new Error('editor closed despite cancel');
    if ((await page.locator('aside textarea').inputValue()) !== 'not saved yet') throw new Error('edit lost');
    page.once('dialog', (d) => d.accept());
    await page.goBack();
    await page.waitForSelector('aside[aria-label="Edit photo"]', { state: 'detached', timeout: 3000 });
  });

  await flow('copy caption + place from one photo to selected photos', async () => {
    const list = await api(ctx, '/api/photos');
    const [src, a, b2] = [list[6], list[7], list[8]];
    await fresh();
    const tiles = page.locator('.grid .thumb');
    await tiles.nth(6).click();
    await page.fill('aside textarea', 'Source caption');
    await page.click('aside footer button:has-text("Save")');
    await page.waitForSelector('.toast:has-text("Saved.")');
    await page.click('aside button[aria-label="Close editor"]');
    await page.click('button:has-text("Select")');
    await tiles.nth(7).click();
    await tiles.nth(8).click();
    await page.click('.selbar button:has-text("Actions")');
    await page.click('dialog button:has-text("Copy from a photo…")');
    await page.waitForSelector('.pickbanner');
    await tiles.nth(6).click();
    await page.waitForSelector('aside section.copy button:has-text("Copy to 2 photos")');
    await page.click('aside section.copy button:has-text("Copy to 2 photos")');
    await page.waitForSelector('.toast:has-text("copied to 2 photos")');
    const after = await api(ctx, '/api/photos');
    for (const id of [a.id, b2.id]) {
      const p = after.find((x) => x.id === id);
      if (p.caption !== 'Source caption') throw new Error(`caption not copied to ${id}`);
      if (p.effectivePlace?.id !== src.effectivePlace?.id) throw new Error(`place not copied to ${id}`);
    }
    await page.click('aside button[aria-label="Close editor"]');
    await page.click('.selbar button:has-text("Done")');
  });

  await flow('bulk Set caption on selected photos', async () => {
    const list = await api(ctx, '/api/photos');
    await fresh();
    await page.click('button:has-text("Select")');
    const tiles = page.locator('.grid .thumb');
    await tiles.nth(9).click();
    await tiles.nth(10).click();
    await page.click('.selbar button:has-text("Actions")');
    await page.click('dialog button:has-text("Set caption…")');
    await page.fill('dialog textarea', 'Group caption');
    await page.click('dialog button:has-text("Set caption")');
    await page.waitForSelector('.toast:has-text("Caption set")');
    const after = await api(ctx, '/api/photos');
    for (const p of [list[9], list[10]]) {
      if (after.find((x) => x.id === p.id).caption !== 'Group caption') throw new Error('group caption not set');
    }
  });

  await ctx.close();
  await b.close();
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n- ${problems.join('\n- ')}` : 'ALL ADMIN UI CHECKS PASSED');
  process.exitCode = problems.length ? 1 : 0;
})();

function location2id(url) {
  return url.split('#photos/')[1];
}
