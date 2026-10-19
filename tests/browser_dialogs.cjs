/* Responsive dialog regressions. Uses an isolated server and deletes its demo. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8766';
const output = process.env.SCREENSHOT_DIR || '/tmp/resume-dialog-shots';
const sizes = [[320, 568], [390, 844], [568, 320], [320, 240], [768, 600], [1440, 900]];
(async () => {
  assert(process.env.ADMIN_PASSWORD, 'Set ADMIN_PASSWORD for the isolated test server');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Simulate a reduced visual viewport separately from real viewport-size tests.
  // Headless browsers cannot open an operating-system software keyboard.
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    let visibleHeight = null, offset = 0;
    Object.defineProperties(viewport, { width: { get: () => innerWidth }, height: { get: () => visibleHeight ?? innerHeight }, offsetLeft: { get: () => 0 }, offsetTop: { get: () => offset } });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    window.resizeVisibleArea = (height = null, top = 0) => { visibleHeight = height; offset = top; viewport.dispatchEvent(new Event('resize')); };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function check(selector, name) {
    await settle();
    const result = await page.locator(selector).evaluate(dialog => {
      const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const form = dialog.querySelector('.modal-card');
      const body = dialog.querySelector('.modal-body, .panel-body');
      return { dialog: rect(dialog), viewport: { width: visualViewport.width, height: visualViewport.height, top: visualViewport.offsetTop }, overflow: dialog.scrollWidth - dialog.clientWidth, formOverflow: form ? form.scrollWidth - form.clientWidth : 0, controls: [...dialog.querySelectorAll('.modal-close, footer button, .sheet-header button')].map(rect), scrollable: body.scrollHeight > body.clientHeight };
    });
    const { dialog: d, viewport: v } = result;
    assert(d.left >= -.5 && d.right <= v.width + .5 && d.top >= v.top - .5 && d.bottom <= v.top + v.height + .5, `${name} outside visible viewport: ${JSON.stringify(result)}`);
    assert(result.overflow <= 1 && result.formOverflow <= 1, `${name} horizontal overflow`);
    for (const c of result.controls) assert(c.left >= d.left && c.right <= d.right && c.top >= d.top && c.bottom <= d.bottom, `${name} hides a control: ${JSON.stringify(result)}`);
    const body = page.locator(`${selector} .modal-body, ${selector} .panel-body`).first();
    await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await settle();
    assert(await page.locator(`${selector} .modal-close, ${selector} .sheet-header button`).isVisible());
    if (v.width === 320 || name.includes('keyboard')) await page.screenshot({ animations: 'disabled', path: `${output}/${name}-${v.width}x${v.height}.png` });
    return result;
  }
  let did;
  try {
    await page.goto(base);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.locator('[data-admin-login]').click();
      const result = await check('#authDialog', 'login');
      if (height === 240) assert(result.scrollable, 'Low-height login must scroll');
      await page.locator('#authDialog .modal-close').click();
    }
    await page.request.post(`${base}/api/auth/login`, { data: { password: process.env.ADMIN_PASSWORD } });
    const response = await page.request.post(`${base}/api/jobs`, { multipart: { demo: '1' } });
    assert(response.ok());
    const { job_id, doc_id } = await response.json(); did = doc_id;
    await page.goto(`${base}/#/job/${job_id}`);
    await page.locator('.a4 .f').first().waitFor({ timeout: 30000 });
    await page.request.put(`${base}/api/docs/${did}`, { data: { annotations: [{ id: 'longnote', path: 'sections.0.items.0.bullets.0', start: 0, end: 4, quote: '服务端链', color: '#e7b23f', note: '很长的批注意见与需要仔细阅读的项目修改建议。'.repeat(100) }] } });
    await page.request.put(`${base}/api/docs/${did}/access`, { data: { password: 'dialog-test-password' } });
    await page.reload();
    await page.locator('.a4 mark.ann').waitFor();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await page.locator('.topbar [data-open-settings]').click();
      const settings = await check('#settings', 'settings');
      if (height <= 320) assert(settings.scrollable, 'Low-height settings must scroll');
      await page.locator('#settings .modal-close').click();
      await page.locator('#shareBtn').click();
      await check('#shareDialog', 'share');
      assert.equal(await page.locator('#shareDialog footer button').count(), 3);
      if (width === 390) {
        await page.locator('#sharePassword').focus();
        await page.evaluate(() => resizeVisibleArea(280, 32));
        await check('#shareDialog', 'share-keyboard');
        await page.evaluate(() => resizeVisibleArea());
        await settle();
      }
      await page.locator('#shareDialog .modal-close').click();
      if (width <= 980) {
        await page.locator('.a4 mark.ann').click();
        await check('.annotation-sheet', 'long-note');
        if (width === 390) {
          await page.locator('.annotation-sheet textarea').focus();
          await page.evaluate(() => resizeVisibleArea(280, 32));
          await check('.annotation-sheet', 'note-keyboard');
          await page.evaluate(() => resizeVisibleArea());
          await settle();
        }
        await page.locator('#closeAnnotationSheet').click();
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: login, settings, three-button sharing and long-note dialogs fit six screen sizes; scrolling, close controls and simulated keyboard viewport verified.');
    console.log(`Screenshots: ${output}`);
  } finally {
    if (did) await page.request.delete(`${base}/api/docs/${did}`);
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
