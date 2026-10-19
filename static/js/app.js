import { createEditor, COLORS } from './editor.js';
import { templates } from './templates/index.js';
import { esc } from './md.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const api = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch { } throw new Error(m); }
  return r.headers.get('content-type')?.includes('json') ? r.json() : r;
};
let settings = { ready: false };
let cleanup = () => { };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2600); }
const ago = ts => { const s = (Date.now() / 1000 - ts) | 0; return s < 60 ? '刚刚' : s < 3600 ? `${(s / 60) | 0} 分钟前` : s < 86400 ? `${(s / 3600) | 0} 小时前` : new Date(ts * 1000).toLocaleDateString(); };
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

function topbar(inner = '', lined = false) {
  return `<div class="topbar ${lined ? 'lined' : ''}">
    <a class="brand" href="#/"><span class="seal">简</span><span class="brand-name">简历工坊<small>Resume Studio</small></span></a>
    ${inner}
    <div class="spacer"></div>
    <button class="btn ghost sm" data-open-settings><span class="keystate"><span class="dot ${settings.ready ? 'ok' : ''}"></span>${settings.ready ? '模型已连接' : '示例模式'}</span></button>
  </div>`;
}

/* ================= landing ================= */
async function landing() {
  const docs = await api('/api/docs').catch(() => []);
  app.innerHTML = topbar() + `
  <main class="landing fade-in">
    <section class="hero">
      <div>
        <div class="eyebrow">Resume Studio · 简历工坊</div>
        <h1>上传一份简历，<br>还你一份<em>排好版</em>的电子稿。</h1>
        <p class="lede">图片或 PDF 都可以。我们逐字誊写内容、整理成结构化数据，再套进一份克制耐看的模板 —— 之后可以直接在页面上改字，也可以选中任意一个字写下批注。</p>
        <div class="steps">
          <div class="step"><div class="n">01 · 识别</div><div class="t">逐字誊写</div><div class="d">通义千问视觉模型读取原件，跳过打码与遮挡区域</div></div>
          <div class="step"><div class="n">02 · 结构化</div><div class="t">整理字段</div><div class="d">DeepSeek 抽取教育、经历、项目、技能，保留加粗重点</div></div>
          <div class="step"><div class="n">03 · 排版</div><div class="t">统一模板</div><div class="d">A4 版式，可编辑、可批注，导出矢量 PDF</div></div>
        </div>
      </div>
      <div class="drop" id="drop">
        ${settings.ready ? '' : `<div class="notice"><span>⚠</span><span>尚未配置模型密钥，上传需要 <b>DashScope</b> 与 <b>DeepSeek</b> Key。<button class="linkbtn" data-open-settings>去配置</button>，或先用示例体验完整流程。</span></div>`}
        <div class="drop-inner" id="dropInner" tabindex="0">
          <div class="paper-stack"><span></span><span></span><span><i class="h"></i><i></i><i class="s"></i><i></i><i class="s"></i><i></i></span></div>
          <h3>拖入你的简历</h3>
          <p>或点击选择文件 · 单个文件不超过 20 MB</p>
          <div class="formats"><span class="tag">PDF</span><span class="tag">PNG</span><span class="tag">JPG</span><span class="tag">WEBP</span></div>
          <input type="file" id="file" accept=".pdf,image/*" hidden>
        </div>
        <div class="drop-foot"><span class="muted">没有现成的简历？</span><button class="btn sm" id="demoBtn">用示例简历体验 →</button></div>
      </div>
    </section>
    ${docs.length ? `<section class="recent"><h4>最近的稿子</h4><div class="recent-list">${docs.map(d => `
      <div class="recent-item" data-doc="${d.id}"><div class="mini"></div><div style="min-width:0"><div class="nm">${esc(d.name || '未命名')}</div>
      <div class="meta">${ago(d.updated)} · ${d.annotations} 条批注${d.demo ? ' · 示例' : ''}</div></div></div>`).join('')}</div></section>` : ''}
  </main>`;
  const drop = $('#drop'), inner = $('#dropInner'), file = $('#file');
  inner.onclick = () => file.click();
  inner.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') file.click(); };
  file.onchange = () => file.files[0] && startUpload(file.files[0]);
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || !drop.contains(e.relatedTarget)) drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) startUpload(f); });
  $('#demoBtn').onclick = () => startJob(null);
  app.querySelectorAll('[data-doc]').forEach(el => (el.onclick = () => (location.hash = `#/doc/${el.dataset.doc}`)));
}

let pendingPreview = null;
function startUpload(f) {
  if (!settings.ready) { toast('请先配置模型密钥'); openSettings(); return; }
  if (f.size > 20 * 1024 * 1024) { toast('文件超过 20 MB'); return; }
  pendingPreview = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
  startJob(f);
}
async function startJob(f) {
  const fd = new FormData();
  if (f) fd.append('file', f); else fd.append('demo', '1');
  try {
    const { job_id } = await api('/api/jobs', { method: 'POST', body: fd });
    sessionStorage.setItem('job-name-' + job_id, f ? f.name : '示例简历 · sample.webp');
    location.hash = `#/job/${job_id}`;
  } catch (e) { toast(e.message); }
}

/* ================= progress ================= */
async function progress(jid) {
  const name = sessionStorage.getItem('job-name-' + jid) || '';
  app.innerHTML = topbar() + `
  <div class="progress-wrap"><div class="progress-card fade-in">
    <div class="scan" id="scan">${pendingPreview ? `<img src="${pendingPreview}">` : '<div class="ph">正在读取文件…</div>'}<div class="grid"></div><div class="beam"></div></div>
    <div>
      <div class="eyebrow">Processing</div>
      <h2 id="ptitle">正在识别内容</h2>
      <div class="file">${esc(name)}</div>
      <ol class="stepper" id="stepper">
        ${[['recognize', '识别', 'Recognizing', '视觉模型逐字誊写，忽略打码与遮挡'], ['structure', '结构化', 'Structuring', '抽取为结构化简历数据，保留加粗重点'], ['typeset', '排版', 'Typesetting', '套用模板，生成可编辑的 A4 版面']]
      .map(([k, t, en, d], i) => `<li data-k="${k}" class="pending"><div class="ic">${i + 1}</div><div><div class="t">${t}<small>${en}</small></div><div class="d">${d}</div></div><div class="tm"></div></li>`).join('')}
      </ol>
      <div class="log" id="log"></div>
    </div>
  </div></div>`;
  const order = ['recognize', 'structure', 'typeset'];
  const stamp = {};
  let alive = true; cleanup = () => { alive = false; };
  const setStage = (stage, elapsed) => {
    const idx = order.indexOf(stage);
    document.querySelectorAll('#stepper li').forEach((li, i) => {
      const k = li.dataset.k;
      li.className = i < idx ? 'done' : i === idx ? 'active' : 'pending';
      li.querySelector('.ic').innerHTML = i < idx ? CHECK : String(i + 1);
      if (i === idx && stamp[k] == null) stamp[k] = elapsed;
      if (i < idx && stamp[order[i + 1]] != null) li.querySelector('.tm').textContent = (stamp[order[i + 1]] - (stamp[k] || 0)).toFixed(1) + 's';
    });
    $('#ptitle').textContent = { recognize: '正在识别内容', structure: '正在整理结构', typeset: '正在排版' }[stage] || '';
    $('#scan').classList.toggle('structure', idx >= 1);
  };
  let shownPage = !!pendingPreview;
  while (alive) {
    let j;
    try { j = await api(`/api/jobs/${jid}`); } catch (e) { $('#log').innerHTML = `<div class="err">任务不存在或已过期。<a href="#/">返回首页</a></div>`; return; }
    if (!shownPage && j.pages.length) { $('#scan').insertAdjacentHTML('afterbegin', `<img src="${j.pages[0]}">`); $('#scan .ph')?.remove(); shownPage = true; }
    $('#log').innerHTML = j.log.map(l => `<div><span class="tt">${l.t.toFixed(1)}s</span>${esc(l.msg)}</div>`).join('');
    $('#log').scrollTop = 1e6;
    if (j.stage === 'error') {
      document.querySelectorAll('#stepper li.active').forEach(li => (li.className = 'pending'));
      $('#ptitle').textContent = '处理失败';
      $('#log').insertAdjacentHTML('beforeend', `<div class="err" style="margin-top:6px">${esc(j.error)} · <a href="#/">返回重试</a></div>`);
      return;
    }
    if (j.stage === 'done') {
      setStage('typeset', j.elapsed);
      const t0 = performance.now();
      const doc = await api(`/api/docs/${j.doc_id}`);
      await Promise.all([document.fonts.load('400 13px "RS Sans"', '简历'), document.fonts.load('700 13px "RS Sans"', '简历')]).catch(() => { });
      await sleep(Math.max(0, 1100 - (performance.now() - t0)));
      document.querySelector('#stepper li[data-k=typeset] .tm').textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
      setStage('done', j.elapsed);
      document.querySelectorAll('#stepper li').forEach(li => { li.className = 'done'; li.querySelector('.ic').innerHTML = CHECK; });
      await sleep(450);
      if (alive) location.hash = `#/doc/${doc.id}`;
      return;
    }
    setStage(j.stage === 'queued' ? 'recognize' : j.stage, j.elapsed);
    await sleep(500);
  }
}

/* ================= editor ================= */
async function editorView(id) {
  let doc;
  try { doc = await api(`/api/docs/${id}`); } catch { location.hash = '#/'; return; }
  doc.annotations = doc.annotations || [];
  app.innerHTML = topbar(`
    <div class="sep"></div>
    <div class="toolbar">
      <input class="docname" id="docname" value="${esc(doc.name || '')}" spellcheck="false">
      <span class="savestate" id="savestate">已保存</span>
    </div>`, true).replace('<div class="spacer"></div>', `<div class="spacer"></div>
    <div class="toolbar">
      <select class="btn sm" id="tplSel" title="模板">${templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}<option disabled>更多模板 · 即将推出</option></select>
      <div class="zoom"><button id="zOut" title="缩小">−</button><span class="val" id="zVal" title="适合宽度">100%</span><button id="zIn" title="放大">+</button></div>
      <div class="menu" id="exportMenu"><button class="btn primary" id="exportBtn">导出 <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></button>
        <div class="menu-pop">
          <button data-exp="pdf"><span>📄</span><span><b>PDF</b><small>A4 矢量排版，文字可复制</small></span></button>
          <button data-exp="pdf-ann"><span>🖍</span><span><b>PDF · 含批注</b><small>保留高亮，并附批注清单</small></span></button>
          <button data-exp="json"><span>{ }</span><span><b>JSON</b><small>结构化数据与批注</small></span></button>
        </div></div>
    </div><div class="sep"></div>`) + `
  <div class="editor fade-in">
    <div class="canvas" id="canvas"><div class="canvas-inner"><div class="page-scale" id="scale"></div></div>
      <div class="hint-bar">点击任意文字直接修改 · 选中文字可 <b>批注</b> 或 <kbd>⌘/Ctrl</kbd><kbd>B</kbd> 加粗 · 要点里 <kbd>Enter</kbd> 新增一条</div></div>
    <aside class="panel">
      <div class="panel-tabs"><button class="on" data-tab="ann">批注<span class="count" id="annCount">0</span></button><button data-tab="src">原件</button></div>
      <div class="panel-body" id="panelBody"></div>
    </aside>
  </div>`;
  $('#tplSel').value = doc.template || 'navy';

  /* saving */
  let saveT, saving = false;
  const ss = $('#savestate');
  const save = () => {
    ss.textContent = '保存中…'; ss.classList.add('busy');
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      saving = true;
      try {
        await api(`/api/docs/${doc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: doc.resume, annotations: doc.annotations.map(({ orphan, ...a }) => a), name: doc.name, template: doc.template }) });
        ss.textContent = '已保存'; ss.classList.remove('busy');
      } catch (e) { ss.textContent = '保存失败'; }
      saving = false;
    }, 500);
  };
  const flush = async () => { if (ss.classList.contains('busy')) { clearTimeout(saveT); saveT = null; ss.classList.add('busy');
    await api(`/api/docs/${doc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: doc.resume, annotations: doc.annotations.map(({ orphan, ...a }) => a), name: doc.name, template: doc.template }) });
    ss.textContent = '已保存'; ss.classList.remove('busy'); } };
  $('#docname').oninput = e => { doc.name = e.target.value; save(); };

  /* panel */
  let tab = 'ann', activeId = null;
  const body = $('#panelBody');
  function renderPanel(soft) {
    $('#annCount').textContent = doc.annotations.length;
    if (tab !== 'ann') return;
    if (soft) { // update quotes only, keep textarea focus
      for (const a of doc.annotations) { const c = body.querySelector(`[data-aid="${a.id}"]`); if (c) { c.querySelector('.q').textContent = a.quote; c.querySelector('.orphan').hidden = !a.orphan; } }
      return;
    }
    if (!doc.annotations.length) {
      body.innerHTML = `<div class="empty-note"><div class="glyph">注</div>在简历上<span class="demo-sel">选中任意文字</span>，哪怕只是一个字，<br>点击浮出的「批注」即可写下意见。<br>批注会随稿件自动保存。</div>`; return;
    }
    const order = ed.order();
    const list = [...doc.annotations].sort((a, b) => (order.indexOf(a.id) + 1 || 1e6) - (order.indexOf(b.id) + 1 || 1e6));
    body.innerHTML = list.map(a => `
      <div class="ann-card ${a.id === activeId ? 'active' : ''}" data-aid="${a.id}" style="--c:${a.color}">
        <div class="q">${esc(a.quote)}</div>
        <textarea rows="1" placeholder="写下批注…">${esc(a.note)}</textarea>
        <div class="foot">${COLORS.map(c => `<button class="sw ${c === a.color ? 'on' : ''}" data-c="${c}" style="background:${c}" title="颜色"></button>`).join('')}
          <span>${new Date(a.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span class="orphan" ${a.orphan ? '' : 'hidden'}>原文已改动</span>
          <button class="del">删除</button></div>
      </div>`).join('');
    body.querySelectorAll('textarea').forEach(autosize);
    ed.paint();
  }
  const autosize = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
  body.addEventListener('input', e => {
    if (e.target.tagName !== 'TEXTAREA') return;
    const a = doc.annotations.find(x => x.id === e.target.closest('.ann-card').dataset.aid);
    a.note = e.target.value; autosize(e.target); ed.paint(); save();
  });
  body.addEventListener('click', e => {
    const card = e.target.closest('.ann-card'); if (!card) return;
    const id = card.dataset.aid, a = doc.annotations.find(x => x.id === id);
    if (e.target.closest('.del')) { ed.removeAnnotation(id); return; }
    const sw = e.target.closest('.sw');
    if (sw) { a.color = sw.dataset.c; card.style.setProperty('--c', a.color); card.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s === sw)); ed.paint(); save(); return; }
    activate(id, 'card');
    if (e.target.closest('.q')) ed.scrollTo(id);
  });
  body.addEventListener('mouseover', e => { const c = e.target.closest('.ann-card'); if (c) ed.highlight(c.dataset.aid); });
  function activate(id, from) {
    activeId = id; ed.highlight(id);
    body.querySelectorAll('.ann-card').forEach(c => c.classList.toggle('active', c.dataset.aid === id));
    const card = body.querySelector(`.ann-card[data-aid="${id}"]`);
    if (card && from !== 'card') card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (from === 'new' && card) card.querySelector('textarea').focus();
  }
  async function renderSource() {
    const md = await fetch(`/api/docs/${doc.id}/transcript`).then(r => r.text()).catch(() => '');
    body.innerHTML = `<div class="src-seg"><button class="btn sm" data-s="img">原件图像</button><button class="btn sm" data-s="md">识别原文</button></div>
      <div id="srcView">${(doc.pages || []).map(p => `<img class="src-img" src="${p}">`).join('') || '<div class="empty-note">没有原件图像</div>'}</div>`;
    body.querySelector('[data-s=img]').onclick = () => (body.querySelector('#srcView').innerHTML = (doc.pages || []).map(p => `<img class="src-img" src="${p}">`).join(''));
    body.querySelector('[data-s=md]').onclick = () => (body.querySelector('#srcView').innerHTML = `<div class="src-md">${esc(md || '（无）')}</div>`);
  }
  document.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => {
    tab = b.dataset.tab; document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    tab === 'ann' ? renderPanel() : renderSource();
  }));

  /* editor */
  const ed = createEditor($('#scale'), doc, { onChange: save, onAnnotations: soft => renderPanel(soft), onActivate: activate });
  renderPanel();

  /* zoom */
  let zoom = 1;
  const canvas = $('#canvas');
  const fit = () => Math.min(1.25, (canvas.clientWidth - 110) / 794);
  const setZoom = z => { zoom = Math.max(.5, Math.min(2, z)); $('#scale').style.zoom = zoom; $('#zVal').textContent = Math.round(zoom * 100) + '%'; };
  setZoom(fit());
  $('#zIn').onclick = () => setZoom(zoom + .1); $('#zOut').onclick = () => setZoom(zoom - .1); $('#zVal').onclick = () => setZoom(fit());
  $('#tplSel').onchange = e => { doc.template = e.target.value; ed.render(); save(); };

  /* export */
  const menu = $('#exportMenu');
  $('#exportBtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
  const closeMenu = () => menu.classList.remove('open');
  document.addEventListener('click', closeMenu);
  menu.querySelectorAll('[data-exp]').forEach(b => (b.onclick = async () => {
    closeMenu();
    const kind = b.dataset.exp;
    if (kind === 'json') {
      const blob = new Blob([JSON.stringify({ resume: doc.resume, annotations: doc.annotations.map(({ orphan, ...a }) => a) }, null, 2)], { type: 'application/json' });
      download(blob, (doc.name || 'resume') + '.json'); return;
    }
    await flush();
    toast('正在生成 PDF…');
    try {
      const r = await fetch(`/api/docs/${doc.id}/pdf?annotations=${kind === 'pdf-ann' ? 1 : 0}`);
      if (!r.ok) throw new Error(r.statusText);
      download(await r.blob(), (doc.name || 'resume') + '.pdf'); toast('PDF 已生成');
    } catch (e) { toast('导出失败：' + e.message); }
  }));
  const onUnload = e => { if (ss.classList.contains('busy')) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onUnload);
  cleanup = () => { ed.destroy(); document.removeEventListener('click', closeMenu); removeEventListener('beforeunload', onUnload); if (ss.classList.contains('busy')) flush(); };
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

/* ================= settings ================= */
function openSettings() {
  const dlg = $('#settings'), f = $('#settingsForm');
  f.dashscope_key.value = settings.dashscope_masked || ''; f.deepseek_key.value = settings.deepseek_masked || '';
  f.qwen_model.value = settings.qwen_model || ''; f.deepseek_model.value = settings.deepseek_model || '';
  dlg.querySelectorAll('.pill').forEach(p => { const ok = settings[p.dataset.k]; p.textContent = ok ? '已配置' : '未配置'; p.classList.toggle('ok', ok); });
  dlg.showModal();
}
$('#settingsForm').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'save') return;
  const f = e.target;
  settings = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    dashscope_key: f.dashscope_key.value, deepseek_key: f.deepseek_key.value, qwen_model: f.qwen_model.value, deepseek_model: f.deepseek_model.value }) });
  toast(settings.ready ? '已保存，模型已连接' : '已保存');
  route();
});
document.addEventListener('click', e => { if (e.target.closest('[data-open-settings]')) openSettings(); });

/* ================= router ================= */
async function route() {
  cleanup(); cleanup = () => { };
  settings = await api('/api/settings').catch(() => settings);
  const [, view, id] = location.hash.split('/');
  if (view === 'job' && id) return progress(id);
  if (view === 'doc' && id) return editorView(id);
  pendingPreview = null;
  return landing();
}
addEventListener('hashchange', route);
route();
