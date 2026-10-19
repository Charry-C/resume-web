import { createEditor, COLORS } from './editor.js';
import { templates } from './templates/index.js';
import { esc } from './md.js';
import { openDialog } from './dialogs.js';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const api = async (url, opt = {}) => {
  const r = await fetch(url, opt);
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch { } throw new Error(m); }
  return r.headers.get('content-type')?.includes('json') ? r.json() : r;
};
let settings = { ready: false };
let identity = { role: 'anonymous' };
const isAdmin = () => identity.role === 'admin';
let cleanup = () => { };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2600); }
const ago = ts => { const s = (Date.now() / 1000 - ts) | 0; return s < 60 ? '刚刚' : s < 3600 ? `${(s / 60) | 0} 分钟前` : s < 86400 ? `${(s / 3600) | 0} 小时前` : new Date(ts * 1000).toLocaleDateString(); };
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

const ICONS = {
  file: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7M8 14h8M8 17h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  logout: '<path d="M9 4H5v16h4m6-13 5 5-5 5M9 12h11"/>',
};
const icon = name => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
const logo = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M8 4h11l6 6v18H8V4Z" fill="currentColor" fill-opacity=".1" stroke="currentColor" stroke-width="1.5"/><path d="M19 4v7h6M12 15h9M12 19h9M12 23h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
function topbar(inner = '', lined = false) {
  return `<header class="topbar ${lined ? 'lined' : ''}">
    <a class="brand" href="#/" aria-label="简历工坊首页"><span class="brand-symbol">${logo}</span><span class="brand-name">Resume Studio<small>简历工坊</small></span></a>
    ${inner}
    <div class="spacer"></div>
    ${isAdmin() ? `<button class="btn ghost sm" data-open-settings><span class="keystate"><span class="dot ${settings.ready ? 'ok' : ''}"></span>${settings.ready ? '模型已连接' : '模型设置'}</span></button><span class="role-label">管理员</span><button class="btn ghost sm" data-logout>${icon('logout')}退出登录</button>` : `<button class="btn ghost sm" data-admin-login>管理员登录 ${icon('arrow')}</button>${identity.role === 'guest' ? `<button class="btn ghost sm" data-logout>${icon('logout')}退出查看</button>` : ''}`}
  </header>`;
}

/* ================= workspace ================= */
async function landing() {
  const docs = await api('/api/docs');
  app.innerHTML = topbar() + `<div class="workspace fade-in">
    <aside class="sidebar" aria-label="工作区导航">
      <div class="workspace-name"><span class="workspace-avatar">R</span><div>我的工作区<small>管理员工作空间</small></div></div>
      <div class="nav-label">工作区</div>
      <nav><a class="nav-item active" href="#/" aria-current="page">${icon('grid')}全部简历<span class="nav-count">${docs.length}</span></a>
        <button class="nav-item" id="sideUpload">${icon('upload')}上传简历</button>
        <button class="nav-item" data-open-settings>${icon('settings')}模型设置</button></nav>
      <div class="sidebar-bottom">${icon('lock')}<div>私密分享<small>每份简历使用独立查看密码</small></div></div>
    </aside>
    <main class="landing">
      <div class="workspace-heading"><div><div class="eyebrow">Workspace / Resumes</div><h1>简历工作区</h1><p class="muted">上传、审阅与批注，在这里管理每一份简历。</p></div><button class="btn primary" id="uploadBtn">${icon('plus')}上传简历</button></div>
      <section class="drop" id="drop" aria-label="上传简历">
        <div class="drop-inner" id="dropInner" role="button" tabindex="0" aria-label="选择简历文件">
          <div class="upload-icon">${icon('upload')}</div><div><h2>拖入一份简历，开始审阅</h2><p>或点击选择文件 <span>PDF、PNG、JPG、WEBP · 最大 20 MB</span></p></div><span class="drop-arrow">${icon('arrow')}</span>
          <input type="file" id="file" accept=".pdf,image/*" hidden>
        </div>
        <div class="drop-foot"><span>${settings.ready ? `${icon('file')}自动识别内容，整理为可编辑的网页简历` : `${icon('settings')}上传前请先 <button class="linkbtn" data-open-settings>配置模型密钥</button>`}</span><button class="btn ghost sm" id="demoBtn">试用示例 ${icon('arrow')}</button></div>
      </section>
      <section class="recent" aria-labelledby="resumeListTitle">
        <div class="list-toolbar"><h2 id="resumeListTitle">最近的简历 <span class="count">${docs.length}</span></h2><label class="search-box">${icon('search')}<input id="resumeSearch" type="search" aria-label="搜索简历" placeholder="搜索简历…"></label></div>
        <div class="list-columns" aria-hidden="true"><span>名称</span><span>批注</span><span>最后更新</span><span></span></div>
        <div class="recent-list">${docs.map(d => `<a class="recent-item" data-doc="${d.id}" data-name="${esc(d.name || '未命名')}" href="#/doc/${d.id}">
          <span class="doc-title"><span class="doc-icon">${icon('file')}</span><span class="nm">${esc(d.name || '未命名')}</span>${d.demo ? '<span class="tag">示例</span>' : ''}</span><span class="doc-comments">${icon('comment')}${d.annotations}</span><time class="meta">${ago(d.updated)}</time><span class="row-arrow">${icon('chevron')}</span></a>`).join('')}</div>
        <div class="empty-list" id="emptyList" ${docs.length ? 'hidden' : ''}>${icon('file')}<h3>还没有简历</h3><p>上传第一份简历，或试用示例开始。</p></div>
        <div class="empty-list" id="searchEmpty" hidden><h3>没有找到匹配的简历</h3><p>试试其他名称。</p></div>
      </section>
      <footer class="workspace-footer"><span>Resume Studio</span><span>${icon('lock')}仅向持有查看密码的人开放</span></footer>
    </main></div>`;
  const drop = $('#drop'), inner = $('#dropInner'), file = $('#file');
  inner.onclick = () => file.click();
  inner.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') file.click(); };
  file.onchange = () => file.files[0] && startUpload(file.files[0]);
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || !drop.contains(e.relatedTarget)) drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) startUpload(f); });
  $('#demoBtn').onclick = () => startJob(null);
  $('#uploadBtn').onclick = $('#sideUpload').onclick = () => file.click();
  $('#resumeSearch').oninput = e => {
    const query = e.target.value.trim().toLocaleLowerCase();
    let visible = 0;
    app.querySelectorAll('[data-doc]').forEach(row => { row.hidden = !row.dataset.name.toLocaleLowerCase().includes(query); if (!row.hidden) visible++; });
    $('#searchEmpty').hidden = !docs.length || visible > 0;
  };
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
  try { doc = await api(`/api/docs/${id}`); } catch { return accessView(id); }
  const writable = isAdmin();
  doc.annotations = doc.annotations || [];
  app.innerHTML = topbar(`
    <div class="sep"></div>
    <div class="toolbar">
      <span class="breadcrumb-icon">${icon('file')}</span><input class="docname" id="docname" value="${esc(doc.name || '')}" spellcheck="false" aria-label="简历名称" ${writable ? '' : 'readonly'}>
      <span class="savestate" id="savestate">${writable ? '已保存' : '只读查看'}</span>
    </div>`, true).replace('<div class="spacer"></div>', `<div class="spacer"></div>
    <div class="toolbar">
      <select class="btn sm" id="tplSel" title="模板" ${writable ? '' : 'hidden'}>${templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}<option disabled>更多模板 · 即将推出</option></select>
      <div class="zoom"><button id="zOut" title="缩小">−</button><span class="val" id="zVal" title="适合宽度">100%</span><button id="zIn" title="放大">+</button></div>
      <button class="btn sm mobile-only" id="sourceBtn">${icon('file')}原件</button>
      ${writable ? `<button class="btn primary" id="shareBtn">${icon('lock')}分享与密码</button>` : ''}
    </div><div class="sep"></div>`) + `
  <div class="editor fade-in">
    <div class="canvas" id="canvas"><div class="canvas-inner"><div class="page-scale" id="scale"></div></div>
      <div class="hint-bar">${writable ? '点击文字修改 · 选中文字添加批注 · 修改自动保存' : '只读查看 · 点击高亮文字查看批注'}</div></div>
    <aside class="panel">
      <div class="panel-tabs"><button class="on" data-tab="ann">${icon('comment')}批注<span class="count" id="annCount">0</span></button><button data-tab="src">${icon('file')}原件</button></div>
      <div class="panel-body" id="panelBody"></div>
    </aside>
  </div>
  <dialog class="annotation-sheet" aria-labelledby="annotationSheetTitle">
    <div class="sheet-handle" aria-hidden="true"></div>
    <header class="sheet-header"><h2 id="annotationSheetTitle">批注意见</h2><button class="btn icon ghost" id="closeAnnotationSheet" aria-label="关闭批注" autofocus>×</button></header>
    <div class="sheet-content"></div>
  </dialog>`;
  $('#tplSel').value = doc.template || 'navy';

  /* saving */
  let saveT, revision = 0, savedRevision = 0, saveChain = Promise.resolve();
  const ss = $('#savestate');
  const persist = () => {
    const version = revision;
    const payload = { resume: doc.resume, annotations: doc.annotations.map(({ orphan, ...a }) => a), name: doc.name, template: doc.template };
    // Serialize requests so an earlier save cannot overwrite a more recent edit.
    const options = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    saveChain = saveChain.catch(() => {}).then(() => api(`/api/docs/${doc.id}`, options)).then(() => {
      savedRevision = version;
      if (savedRevision === revision) { ss.textContent = '已保存'; ss.classList.remove('busy'); }
    });
    return saveChain;
  };
  const save = () => {
    if (!writable) return;
    revision++;
    ss.textContent = '保存中…'; ss.classList.add('busy'); clearTimeout(saveT);
    saveT = setTimeout(() => persist().catch(() => { ss.textContent = '保存失败'; }), 500);
  };
  const flush = async () => {
    if (!writable) return;
    clearTimeout(saveT);
    await saveChain.catch(() => {});
    if (savedRevision !== revision) await persist();
  };
  if (writable) $('#docname').oninput = e => { doc.name = e.target.value; save(); };

  /* panel */
  let tab = 'ann', activeId = null;
  const body = $('#panelBody');
  const panel = app.querySelector('.panel');
  const panelHome = app.querySelector('.editor');
  const sheet = app.querySelector('.annotation-sheet');
  const mobile = matchMedia('(max-width: 980px)');
  let annotationFitFrame;
  function fitAnnotationFields() { body.querySelectorAll('textarea').forEach(autosize); }
  function scheduleAnnotationFit() {
    cancelAnimationFrame(annotationFitFrame);
    annotationFitFrame = requestAnimationFrame(() => { if (body.isConnected) fitAnnotationFields(); });
  }
  function mountPanel() {
    if (sheet.open) sheet.close();
    (mobile.matches ? sheet.querySelector('.sheet-content') : panelHome).append(panel);
    scheduleAnnotationFit();
  }
  mountPanel();
  mobile.addEventListener('change', mountPanel);
  $('#closeAnnotationSheet').onclick = () => sheet.close();
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  sheet.addEventListener('close', () => {
    activeId = null;
    ed.highlight(null);
    body.querySelectorAll('.ann-card').forEach(card => card.classList.remove('active'));
  });
  function openSheet(title) {
    $('#annotationSheetTitle').textContent = title;
    sheet.dataset.view = tab;
    if (!sheet.open) sheet.showModal();
    fitAnnotationFields();
  }
  $('#sourceBtn').onclick = () => {
    tab = 'src';
    syncTabs();
    renderSource();
    openSheet('简历原件');
  };
  function renderPanel(soft) {
    $('#annCount').textContent = doc.annotations.length;
    if (tab !== 'ann') return;
    if (activeId && !doc.annotations.some(a => a.id === activeId)) {
      activeId = null;
      if (sheet.open) sheet.close();
    }
    if (soft) { // update quotes only, keep textarea focus
      for (const a of doc.annotations) { const c = body.querySelector(`[data-aid="${a.id}"]`); if (c) { c.querySelector('.q').textContent = a.quote; c.querySelector('.orphan').hidden = !a.orphan; } }
      return;
    }
    if (!doc.annotations.length) {
      body.innerHTML = `<div class="empty-note"><div class="empty-icon">${icon('comment')}</div>${writable ? '选中简历文字，点击「批注」写下意见。批注会自动保存。' : '这份简历暂时没有批注。'}</div>`; return;
    }
    const order = ed.order();
    const list = [...doc.annotations].sort((a, b) => (order.indexOf(a.id) + 1 || 1e6) - (order.indexOf(b.id) + 1 || 1e6));
    body.innerHTML = list.map(a => `
      <div class="ann-card ${a.id === activeId ? 'active' : ''}" data-aid="${a.id}" style="--c:${a.color}">
        <div class="q">${esc(a.quote)}</div>
        ${writable ? `<textarea rows="1" placeholder="写下批注…">${esc(a.note)}</textarea>` : `<div class="annotation-note">${esc(a.note || '（未填写）')}</div>`}
        <div class="foot">${(writable ? COLORS : []).map(c => `<button class="sw ${c === a.color ? 'on' : ''}" data-c="${c}" style="background:${c}" title="颜色"></button>`).join('')}
          <span class="orphan" ${a.orphan ? '' : 'hidden'}>原文已改动</span>
          ${writable ? '<button class="del">删除</button>' : ''}</div>
      </div>`).join('');
    fitAnnotationFields();
    ed.paint();
  }
  const autosize = t => {
    // Hidden cards have no measurable width. Size them when shown instead.
    if (!t.getClientRects().length || !t.clientWidth) return;
    const style = getComputedStyle(t);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const scroll = body.scrollTop;
    t.style.height = 'auto';
    // scrollHeight includes padding, but a border-box height also needs borders.
    t.style.height = Math.ceil(t.scrollHeight + borders) + 'px';
    body.scrollTop = scroll;
  };
  let annotationWidth;
  const annotationSizer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === annotationWidth) return;
    annotationWidth = entry.contentRect.width;
    if (annotationWidth > 0) scheduleAnnotationFit();
  });
  annotationSizer.observe(body);
  document.fonts.ready.then(scheduleAnnotationFit);
  document.fonts.addEventListener('loadingdone', scheduleAnnotationFit);
  body.addEventListener('input', e => {
    if (!writable || e.target.tagName !== 'TEXTAREA') return;
    const a = doc.annotations.find(x => x.id === e.target.closest('.ann-card').dataset.aid);
    a.note = e.target.value; autosize(e.target); ed.paint(); save();
  });
  body.addEventListener('click', e => {
    const card = e.target.closest('.ann-card'); if (!card) return;
    const id = card.dataset.aid, a = doc.annotations.find(x => x.id === id);
    if (writable && e.target.closest('.del')) { ed.removeAnnotation(id); return; }
    const sw = e.target.closest('.sw');
    if (writable && sw) { a.color = sw.dataset.c; card.style.setProperty('--c', a.color); card.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s === sw)); ed.paint(); save(); return; }
    activate(id, 'card');
    if (e.target.closest('.q')) ed.scrollTo(id);
  });
  body.addEventListener('mouseover', e => { const c = e.target.closest('.ann-card'); if (c) ed.highlight(c.dataset.aid); });
  function activate(id, from) {
    if (tab !== 'ann') { tab = 'ann'; syncTabs(); renderPanel(); }
    activeId = id; ed.highlight(id);
    body.querySelectorAll('.ann-card').forEach(c => c.classList.toggle('active', c.dataset.aid === id));
    const card = body.querySelector(`.ann-card[data-aid="${id}"]`);
    if (mobile.matches && card) openSheet('批注意见');
    if (!mobile.matches && card && from !== 'card') card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (from === 'new' && card) card.querySelector('textarea').focus();
  }
  async function renderSource() {
    body.innerHTML = '<div class="empty-note">正在读取原件…</div>';
    const md = await fetch(`/api/docs/${doc.id}/transcript`).then(r => r.text()).catch(() => '');
    if (tab !== 'src' || !body.isConnected) return;
    body.innerHTML = `<div class="src-seg"><button class="btn sm" data-s="img">原件图像</button><button class="btn sm" data-s="md">识别原文</button></div>
      <div id="srcView">${(doc.pages || []).map(p => `<img class="src-img" src="${p}">`).join('') || '<div class="empty-note">没有原件图像</div>'}</div>`;
    body.querySelector('[data-s=img]').onclick = () => (body.querySelector('#srcView').innerHTML = (doc.pages || []).map(p => `<img class="src-img" src="${p}">`).join(''));
    body.querySelector('[data-s=md]').onclick = () => (body.querySelector('#srcView').innerHTML = `<div class="src-md">${esc(md || '（无）')}</div>`);
  }
  function syncTabs() { panel.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab)); }
  panel.querySelectorAll('[data-tab]').forEach(b => (b.onclick = () => {
    tab = b.dataset.tab; syncTabs();
    tab === 'ann' ? renderPanel() : renderSource();
  }));

  /* editor */
  const ed = createEditor($('#scale'), doc, { editable: writable, onChange: save, onAnnotations: soft => renderPanel(soft), onActivate: activate });
  renderPanel();

  /* zoom */
  let zoom = 1;
  const canvas = $('#canvas');
  const fit = () => Math.min(1.25, (canvas.clientWidth - (innerWidth <= 980 ? 32 : 110)) / 794);
  const setZoom = z => { zoom = Math.max(.25, Math.min(2, z)); $('#scale').style.zoom = zoom; $('#zVal').textContent = Math.round(zoom * 100) + '%'; };
  const onResize = () => {
    panelHome.style.setProperty('--editor-topbar-height', app.querySelector('.topbar').offsetHeight + 'px');
    setZoom(fit());
  };
  onResize();
  addEventListener('resize', onResize);
  $('#zIn').onclick = () => setZoom(zoom + .1); $('#zOut').onclick = () => setZoom(zoom - .1); $('#zVal').onclick = () => setZoom(fit());
  $('#tplSel').onchange = e => { doc.template = e.target.value; ed.render(); save(); };

  if (writable) $('#shareBtn').onclick = async () => {
    try { await flush(); await shareDialog(doc); } catch (e) { toast(e.message); }
  };
  const onUnload = e => { if (ss.classList.contains('busy')) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', onUnload);
  cleanup = async () => { await flush(); if (sheet.open) sheet.close(); mobile.removeEventListener('change', mountPanel); annotationSizer.disconnect(); cancelAnimationFrame(annotationFitFrame); document.fonts.removeEventListener('loadingdone', scheduleAnnotationFit); ed.destroy(); removeEventListener('beforeunload', onUnload); removeEventListener('resize', onResize); };
}

/* ================= private access ================= */
const jsonOptions = (method, payload) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
function accessView(id = null) {
  app.innerHTML = topbar() + `<main class="access-wrap fade-in"><section class="access-card" aria-labelledby="accessTitle">
    <div class="access-mark">${logo}</div>
    <div class="eyebrow">Your resume, reviewed.</div>
    <h1 id="accessTitle">查看你的简历</h1>
    <p class="muted">输入专属查看密码，阅读简历与批注意见。</p>
    <form id="unlockForm"><div class="field"><label for="viewPassword">查看密码</label>
      <div class="input-icon">${icon('lock')}<input id="viewPassword" name="password" type="password" required maxlength="128" autocomplete="current-password" placeholder="输入管理员提供的密码"></div></div>
      <p class="err" id="unlockError" role="alert"></p><button class="btn primary" type="submit">打开简历 ${icon('arrow')}</button></form>
    <div class="access-foot">${icon('lock')}你的简历与批注，仅凭专属密码查看</div>
    ${!id && identity.role === 'guest' ? `<a class="btn continue-link" href="#/doc/${esc(identity.doc_id)}">继续查看已解锁的简历 ${icon('arrow')}</a>` : ''}
    </section><footer class="access-footer"><span>Resume Studio</span><span>私密、专注的简历审阅空间</span></footer></main>`;
  $('#unlockForm').onsubmit = async e => {
    e.preventDefault();
    const button = e.target.querySelector('button'); button.disabled = true;
    $('#unlockError').textContent = '';
    try {
      const result = await api('/api/auth/unlock', jsonOptions('POST', { password: e.target.password.value, ...(id ? { doc_id: id } : {}) }));
      e.target.reset();
      if (location.hash === `#/doc/${result.doc_id}`) await route(); else location.hash = `#/doc/${result.doc_id}`;
    } catch (error) { $('#unlockError').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
function adminLogin() {
  const dlg = $('#authDialog');
  dlg.innerHTML = `<form class="modal-card" id="loginForm"><header><div class="dialog-icon">${icon('lock')}</div><div class="eyebrow">Workspace access</div><h3>管理员登录</h3><p class="muted">登录后可上传简历、编辑内容、添加批注和管理查看密码。</p></header>
    <div class="field"><label for="adminPassword">管理员密码</label><input id="adminPassword" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></div>
    <p class="err" role="alert" id="loginError"></p><footer><button type="button" class="btn ghost" data-close>取消</button><button type="submit" class="btn primary">登录</button></footer></form>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true;
    try { await api('/api/auth/login', jsonOptions('POST', { password: e.target.password.value })); e.target.reset(); dlg.close(); await route(); }
    catch (error) { $('#loginError').textContent = error.message; }
    finally { button.disabled = false; }
  };
  openDialog(dlg);
}
async function shareDialog(doc) {
  const status = await api(`/api/docs/${doc.id}/access`);
  const dlg = $('#shareDialog');
  const url = new URL(location.href); url.hash = `#/doc/${doc.id}`;
  dlg.innerHTML = `<form class="modal-card"><header><div class="dialog-icon">${icon('lock')}</div><div class="eyebrow">Private sharing</div><h3>分享与查看密码</h3><p class="muted" id="shareStatus">${status.enabled ? '分享已开启。重设密码或关闭分享后，原有查看权限立即失效。' : '分享尚未开启。设置独立密码后，对方即可查看这份简历。'}</p></header>
    <div class="field"><label for="shareLink">简历链接</label><input id="shareLink" value="${esc(url.href)}" readonly><button type="button" class="btn sm copy-link">复制链接</button></div>
    <div class="field"><label for="sharePassword">${status.enabled ? '新的查看密码' : '查看密码'}</label><input id="sharePassword" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="至少 8 个字符，每份简历使用不同密码"><button type="button" class="btn sm generate-password">生成并显示密码</button></div>
    <p class="muted">密码保存后无法回显，请记录并交给本人。对方也可以在站点首页直接输入密码查看。</p>
    <p class="err" id="shareError" role="alert"></p><footer><button type="button" class="btn ghost" data-close>完成</button>${status.enabled ? '<button type="button" class="btn disable-share">关闭分享</button>' : ''}<button type="submit" class="btn primary">保存密码</button></footer></form>`;
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.querySelector('.copy-link').onclick = async () => { try { await navigator.clipboard.writeText(url.href); toast('链接已复制'); } catch { $('#shareLink').select(); toast('请复制已选中的链接'); } };
  dlg.querySelector('.generate-password').onclick = () => {
    const input = $('#sharePassword'); input.type = 'text';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    input.value = Array.from(crypto.getRandomValues(new Uint8Array(12)), x => alphabet[x % alphabet.length]).join('');
  };
  dlg.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('[type=submit]'); button.disabled = true;
    try {
      await api(`/api/docs/${doc.id}/access`, jsonOptions('PUT', { password: e.target.password.value }));
      $('#shareStatus').textContent = '分享已开启，查看密码已保存。请记录密码并交给本人。';
      toast('查看密码已保存');
      if (!dlg.querySelector('.disable-share')) addDisableButton();
    } catch (error) { $('#shareError').textContent = error.message; }
    finally { button.disabled = false; }
  };
  function addDisableButton() {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn disable-share'; button.textContent = '关闭分享';
    dlg.querySelector('footer').insertBefore(button, dlg.querySelector('[type=submit]')); bindDisable(button);
  }
  function bindDisable(button) { button.onclick = async () => {
    button.disabled = true;
    try { await api(`/api/docs/${doc.id}/access`, jsonOptions('PUT', { enabled: false })); dlg.close(); toast('分享已关闭，原查看密码已失效'); }
    catch (error) { $('#shareError').textContent = error.message; button.disabled = false; }
  }; }
  if (dlg.querySelector('.disable-share')) bindDisable(dlg.querySelector('.disable-share'));
  openDialog(dlg);
}

/* ================= settings ================= */
function openSettings() {
  if (!isAdmin()) return;
  const dlg = $('#settings'), f = $('#settingsForm');
  f.dashscope_key.value = settings.dashscope_masked || ''; f.deepseek_key.value = settings.deepseek_masked || '';
  f.qwen_model.value = settings.qwen_model || ''; f.deepseek_model.value = settings.deepseek_model || '';
  dlg.querySelectorAll('.pill').forEach(p => { const ok = settings[p.dataset.k]; p.textContent = ok ? '已配置' : '未配置'; p.classList.toggle('ok', ok); });
  openDialog(dlg);
}
$('#settingsForm').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const f = e.target;
  try {
  settings = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    dashscope_key: f.dashscope_key.value, deepseek_key: f.deepseek_key.value, qwen_model: f.qwen_model.value, deepseek_model: f.deepseek_model.value }) });
  $('#settings').close();
  toast(settings.ready ? '已保存，模型已连接' : '已保存');
  await route();
  } catch (error) { toast(error.message); }
});
document.addEventListener('click', async e => {
  if (e.target.closest('[data-open-settings]')) openSettings();
  if (e.target.closest('[data-admin-login]')) adminLogin();
  if (e.target.closest('[data-logout]')) {
    try {
      await cleanup(); cleanup = () => {};
      await api('/api/auth/logout', { method: 'POST' });
      $('#settings').close(); $('#authDialog').close(); $('#shareDialog').close();
      await route();
    } catch (error) { toast(error.message); }
  }
});

/* ================= router ================= */
async function route() {
  try { await cleanup(); } catch (error) { toast('保存失败：' + error.message); } cleanup = () => { };
  app.innerHTML = '<div class="progress-wrap"><p class="muted">正在加载…</p></div>';
  identity = await api('/api/auth/session');
  settings = isAdmin() ? await api('/api/settings') : { ready: false };
  const [, view, id] = location.hash.split('/');
  if (view === 'job' && id && isAdmin()) return progress(id);
  if (view === 'doc' && id) return editorView(id);
  pendingPreview = null;
  return isAdmin() ? landing() : accessView();
}
const navigate = () => route().catch(error => { app.innerHTML = '<main class="access-wrap"><p role="alert">暂时无法连接服务，请刷新重试。</p></main>'; toast(error.message); });
addEventListener('hashchange', navigate);
navigate();
