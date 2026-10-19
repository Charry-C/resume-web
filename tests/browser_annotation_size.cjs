/* Verify actual textarea content fits after input, reload and responsive changes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const base = process.env.BASE_URL || 'http://127.0.0.1:8766';
  assert(process.env.ADMIN_PASSWORD, 'Set ADMIN_PASSWORD for the isolated test server');
  const output = process.env.SCREENSHOT_DIR || '/tmp/resume-annotation-size-shots';
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const page = await browser.newPage({ viewport: { width: 1480, height: 940 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const failures = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const note = '对接了几家模型服务？TTFT优化到了多少毫秒？\n有没有做失败降级等处理？\n请补充具体的技术方案与量化指标。\n这是最后一行批注意见，应当完整显示。';
  const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  async function check(label) {
    await settle();
    const fields = await page.locator('.ann-card textarea:visible').evaluateAll(nodes => nodes.map(el => ({ value: el.value, height: el.clientHeight, content: el.scrollHeight })));
    assert(fields.length, `${label}: no visible annotations`);
    for (const field of fields) if (field.content > field.height) failures.push({ label, ...field });
  }
  let did;
  try {
    assert((await page.request.post(`${base}/api/auth/login`, { data: { password: process.env.ADMIN_PASSWORD } })).ok());
    const { job_id, doc_id } = await (await page.request.post(`${base}/api/jobs`, { multipart: { demo: '1' } })).json(); did = doc_id;
    await page.goto(`${base}/#/job/${job_id}`);
    await page.locator('.a4 .f').first().waitFor({ timeout: 30000 });
    assert((await page.request.put(`${base}/api/docs/${did}`, { data: { annotations: [
      { id: 'sizing1', path: 'sections.0.title', start: 0, end: 4, quote: '实习经历', color: '#e7b23f', note: '没有任何量化结果，尝试使用 star 法则' },
      { id: 'sizing2', path: 'sections.0.items.0.bullets.0', start: 0, end: 4, quote: '服务端链', color: '#4f78c4', note },
    ] } })).ok());
    await page.reload();
    await page.locator('.ann-card textarea').first().waitFor();
    await check('desktop reload');
    const field = page.locator('.ann-card textarea').nth(1);
    await field.fill(note.repeat(3));
    await check('multiline input');
    await field.fill('缩短后的批注');
    await check('shortened input');
    await field.fill(note);
    await page.locator('#savestate').filter({ hasText: '已保存' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('.a4 mark.ann').first().waitFor();
    await page.setViewportSize({ width: 1480, height: 940 });
    await check('mobile reload then desktop');
    await page.screenshot({ animations: 'disabled', path: `${output}/desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.a4 mark.ann[data-aid=sizing2]').click();
    await check('mobile long annotation');
    await page.locator('#closeAnnotationSheet').click();
    await page.locator('.a4 mark.ann[data-aid=sizing1]').click();
    await check('mobile other annotation');
    await page.setViewportSize({ width: 1480, height: 940 });
    await check('sheet to desktop');
    // Loading or changing fonts must also resize already-rendered annotations.
    await page.addStyleTag({ content: '.ann-card textarea { font-size: 20px !important; line-height: 2 !important; }' });
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await check('font metrics changed');
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    console.log('PASS: long and multiline annotations fit completely after input, shortening, font changes, mobile reload and viewport transitions.');
    console.log(`Screenshots: ${output}`);
  } finally {
    if (did) await page.request.delete(`${base}/api/docs/${did}`);
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
