// Editor core: renders a template into an editable A4 sheet, keeps every edit bound to the
// resume JSON, and anchors per-character annotations ({path,start,end,quote}) to fields.
import { esc, mdToHtml, domToMd } from './md.js';
import { getTemplate } from './templates/index.js';

export const COLORS = ['#e7b23f', '#e0795a', '#4f78c4', '#5fa37a', '#9b6fc4'];
const PRINT_BODY = 1123 - 94; // print margins 12.5mm top+bottom

export const getAt = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
export function setAt(o, path, v) {
  const ks = path.split('.');
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]] ??= (/^\d+$/.test(ks[i + 1]) ? [] : {});
  o[ks.at(-1)] = v;
}

const I = {
  up: '<path d="M4 10l4-4 4 4"/>', down: '<path d="M4 6l4 4 4-4"/>',
  add: '<path d="M8 3.5v9M3.5 8h9"/>', del: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
};
const svg = k => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;

/** Template helpers. editable=false → clean print markup, empty fields omitted. */
export function makeHelpers(editable) {
  return {
    editable,
    field(path, val, { ph = '', cls = '', block = false, bullet = false } = {}) {
      const v = val ?? '';
      if (!editable && !String(v).trim()) return '';
      const tag = block ? 'div' : 'span';
      const ed = editable ? ` contenteditable="true" spellcheck="false" data-ph="${esc(ph)}"` : '';
      return `<${tag} class="f ${cls}${block ? ' blk' : ''}" data-path="${path}"${bullet ? ' data-bullet="1"' : ''}${ed}>${mdToHtml(v)}</${tag}>`;
    },
    item(path, inner, { tag = 'div', kind = '', cls = '' } = {}) {
      const tools = editable ? `<span class="item-tools" contenteditable="false">
        <button data-act="up" title="上移">${svg('up')}</button><button data-act="down" title="下移">${svg('down')}</button>
        <button data-act="add" title="在下方新增">${svg('add')}</button><button data-act="del" class="del" title="删除">${svg('del')}</button></span>` : '';
      return `<${tag} class="item ${cls}" data-item="${path}" data-kind="${kind}">${inner}${tools}</${tag}>`;
    },
    addButton(sec, type) {
      return editable ? `<div class="add-row"><button data-add="${sec}" data-type="${type}" title="添加${type === 'entries' ? '一段经历' : '一条'}">＋</button></div>` : '';
    },
  };
}

/** Wrap plain-text range [start,end) of el in <mark class="ann">; returns the marks. */
export function wrapOffsets(el, start, end, id) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const hits = []; let pos = 0, n;
  while ((n = w.nextNode())) {
    const L = n.nodeValue.length, s = Math.max(start, pos), e = Math.min(end, pos + L);
    if (e > s) hits.push([n, s - pos, e - pos]);
    pos += L; if (pos >= end) break;
  }
  return hits.map(([node, s, e]) => {
    if (e < node.nodeValue.length) node.splitText(e);
    const t = s > 0 ? node.splitText(s) : node;
    const m = document.createElement('mark'); m.className = 'ann'; m.dataset.aid = id;
    t.parentNode.insertBefore(m, t); m.appendChild(t);
    return m;
  });
}

/** Make sure a.start/a.end still point at a.quote inside el; re-anchor to the nearest match. */
export function anchor(el, a) {
  const txt = el.textContent;
  if (!a.quote) return false;
  if (txt.slice(a.start, a.end) === a.quote) return true;
  let best = -1, i = txt.indexOf(a.quote);
  while (i >= 0) { if (best < 0 || Math.abs(i - a.start) < Math.abs(best - a.start)) best = i; i = txt.indexOf(a.quote, i + 1); }
  if (best < 0) return false;
  a.start = best; a.end = best + a.quote.length; return true;
}

const blankItem = kind => kind === 'entry' ? { start: '', end: '', title: '', role: '', location: '', details: [], bullets: [''] }
  : kind === 'kv' ? { label: '', text: '' } : '';
const kindOfType = t => (t === 'entries' ? 'entry' : t === 'keyvalue' ? 'kv' : 'list');
const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function createEditor(host, doc, { editable = true, onChange = () => {}, onAnnotations = () => {}, onActivate = () => {} } = {}) {
  const H = makeHelpers(editable);
  const R = () => doc.resume;
  let sheet, ro;

  const pop = document.createElement('div');
  pop.className = 'selpop'; pop.hidden = true;
  pop.innerHTML = `<button data-pop="ann"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3.5h10v7H8l-3 2.5v-2.5H3z"/></svg>批注</button>
    <button data-pop="bold"><b style="font-size:14px">B</b>加粗</button>`;
  document.body.appendChild(pop);

  const field = path => sheet.querySelector(`.f[data-path="${CSS.escape(path)}"]`);
  const fieldOf = node => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('.f[contenteditable]');

  function render(focusPath, atEnd) {
    const tpl = getTemplate(doc.template);
    host.innerHTML = `<div class="a4">${tpl.render(R(), H)}</div>`;
    sheet = host.firstElementChild;
    paint();
    ro?.disconnect(); let bt; ro = new ResizeObserver(() => { clearTimeout(bt); bt = setTimeout(breaks, 250); }); ro.observe(sheet);
    if (focusPath) { const f = field(focusPath); if (f) placeCaret(f, atEnd); }
  }
  // Page guides: lay the template out exactly as print does (no placeholders, print width),
  // find the first field crossing each page boundary, and mark that spot in the editor.
  function breaks() {
    sheet.querySelectorAll(':scope > .page-break').forEach(b => b.remove());
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:686px;visibility:hidden';
    probe.innerHTML = getTemplate(doc.template).render(R(), makeHelpers(false));
    document.body.appendChild(probe);
    const top0 = probe.getBoundingClientRect().top, fs = [...probe.querySelectorAll('.f[data-path]')];
    const sTop = sheet.getBoundingClientRect().top, z = sheet.getBoundingClientRect().height / sheet.offsetHeight || 1;
    for (let k = 1, guard = 0; guard < 20; k++, guard++) {
      const lim = k * PRINT_BODY;
      const f = fs.find(x => x.getBoundingClientRect().bottom - top0 > lim);
      if (!f) break;
      const ed = field(f.dataset.path)?.closest('li, p, .nv-entry-head, h2, .f') ;
      if (!ed) continue;
      const y = (ed.getBoundingClientRect().top - sTop) / z - 4;
      sheet.insertAdjacentHTML('beforeend', `<div class="page-break" style="top:${y}px"><span>第 ${k + 1} 页</span></div>`);
    }
    probe.remove();
  }
  function placeCaret(el, atEnd = true) {
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(!atEnd);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  /* -------- annotation painting -------- */
  function unwrapAll() {
    sheet.querySelectorAll('mark.ann').forEach(m => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); });
  }
  function paint() {
    if (!sheet) return;
    unwrapAll();
    for (const a of doc.annotations) {
      const el = a.path && field(a.path);
      if (!el || !anchor(el, a)) { a.orphan = true; continue; }
      a.orphan = false;
      wrapOffsets(el, a.start, a.end, a.id).forEach(m => {
        m.style.background = a.color + '4d'; m.style.boxShadow = `inset 0 -2px 0 ${a.color}`;
        m.title = a.note || '';
      });
    }
  }
  function highlight(id) { sheet.querySelectorAll('mark.ann').forEach(m => { const on = m.dataset.aid === id; m.classList.toggle('active', on); const a = doc.annotations.find(x => x.id === m.dataset.aid); if (a) m.style.background = a.color + (on ? '99' : '4d'); }); }
  function scrollTo(id) { sheet.querySelector(`mark.ann[data-aid="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  function removeAnnotation(id) {
    if (!editable) return;
    const i = doc.annotations.findIndex(a => a.id === id); if (i < 0) return;
    doc.annotations.splice(i, 1); paint(); onAnnotations(false); onChange();
  }
  function order() {
    const ids = [...new Set([...sheet.querySelectorAll('mark.ann')].map(m => m.dataset.aid))];
    return [...ids, ...doc.annotations.filter(a => !ids.includes(a.id)).map(a => a.id)];
  }

  /* -------- structural edits with annotation remapping -------- */
  function remap(parent, fn) { // fn(oldIndex) -> newIndex | null (deleted)
    const pre = parent + '.';
    doc.annotations = doc.annotations.filter(a => {
      if (!a.path.startsWith(pre)) return true;
      const rest = a.path.slice(pre.length), [idx, ...tail] = rest.split('.');
      if (!/^\d+$/.test(idx)) return true;
      const ni = fn(+idx); if (ni == null) return false;
      a.path = [parent, ni, ...tail].join('.'); return true;
    });
  }
  function splitPath(p) { const ks = p.split('.'); return [ks.slice(0, -1).join('.'), +ks.at(-1)]; }
  function insertAt(parent, i, val) { getAt(R(), parent).splice(i, 0, val); remap(parent, j => (j >= i ? j + 1 : j)); }
  function removeAt(parent, i) { getAt(R(), parent).splice(i, 1); remap(parent, j => (j === i ? null : j > i ? j - 1 : j)); }
  function swap(parent, i, j) {
    const arr = getAt(R(), parent); if (j < 0 || j >= arr.length) return false;
    [arr[i], arr[j]] = [arr[j], arr[i]]; remap(parent, k => (k === i ? j : k === j ? i : k)); return true;
  }
  const firstField = p => { const it = sheet.querySelector(`[data-item="${CSS.escape(p)}"] .f[contenteditable]`); return it?.dataset.path || p; };
  function structural(focus, atEnd = true) { render(); if (focus) { const f = field(focus) || field(firstField(focus)); if (f) placeCaret(f, atEnd); } onAnnotations(false); onChange(); }

  /* -------- field sync -------- */
  function sync(el) {
    if (!el.textContent) el.innerHTML = '';
    const { md, marks } = domToMd(el);
    const path = el.dataset.path;
    setAt(R(), path, md);
    const plain = el.textContent;
    let touched = false;
    for (const a of doc.annotations) {
      if (a.path !== path) continue;
      const m = marks[a.id];
      if (m && m.end > m.start) { a.start = m.start; a.end = m.end; a.quote = plain.slice(m.start, m.end); a.orphan = false; }
      else a.orphan = true;
      touched = true;
    }
    if (touched) onAnnotations(true);
    onChange();
  }

  /* -------- events -------- */
  const onInput = e => { const el = fieldOf(e.target); if (el) sync(el); };
  const onKey = e => {
    const el = fieldOf(e.target); if (!el) return;
    const path = el.dataset.path, item = el.closest('.item');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); document.execCommand('bold'); sync(el); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (el.dataset.bullet) { const [par, i] = splitPath(path); insertAt(par, i + 1, ''); return structural(`${par}.${i + 1}`); }
      if (item && (item.dataset.kind === 'list' || item.dataset.kind === 'kv')) {
        const [par, i] = splitPath(item.dataset.item); insertAt(par, i + 1, blankItem(item.dataset.kind)); return structural(`${par}.${i + 1}`);
      }
      return;
    }
    if (e.key === 'Backspace' && !el.textContent) {
      const isList = item && item.dataset.kind === 'list';
      if (el.dataset.bullet || isList) {
        e.preventDefault();
        const [par, i] = splitPath(isList ? item.dataset.item : path);
        if (getAt(R(), par).length <= 1 && el.dataset.bullet === undefined) return;
        removeAt(par, i);
        const prev = i > 0 ? `${par}.${i - 1}` : null;
        return structural(prev);
      }
    }
  };
  const onPaste = e => {
    if (!fieldOf(e.target)) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' '));
  };
  const onClick = e => {
    const act = e.target.closest('[data-act]');
    if (editable && act) {
      const it = act.closest('.item'), p = it.dataset.item, kind = it.dataset.kind, [par, i] = splitPath(p);
      if (act.dataset.act === 'del') { removeAt(par, i); return structural(); }
      if (act.dataset.act === 'add') { insertAt(par, i + 1, blankItem(kind)); return structural(`${par}.${i + 1}`); }
      if (swap(par, i, i + (act.dataset.act === 'up' ? -1 : 1))) structural();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (editable && add) { const par = add.dataset.add + '.items', arr = getAt(R(), par); insertAt(par, arr.length, blankItem(kindOfType(add.dataset.type))); return structural(`${par}.${arr.length - 1}`); }
    const m = e.target.closest('mark.ann');
    if (m && getSelection().isCollapsed) onActivate(m.dataset.aid, 'mark');
  };

  /* -------- selection popover -------- */
  let selField = null;
  function selInfo() {
    const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0), f = fieldOf(r.startContainer);
    if (!f || f !== fieldOf(r.endContainer) || !host.contains(f)) return null;
    const pre = document.createRange(); pre.selectNodeContents(f); pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length, quote = r.toString();
    if (!quote.trim()) return null;
    return { f, r, start, end: start + quote.length, quote };
  }
  const onSel = () => {
    const info = selInfo();
    if (!info) { pop.hidden = true; selField = null; return; }
    selField = info.f;
    const rects = info.r.getClientRects(), b = rects[0] || info.r.getBoundingClientRect();
    pop.hidden = false;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(left + 8, Math.min(left + width - w - 8, b.left + b.width / 2 - w / 2)) + 'px';
    pop.style.top = Math.max(top + 8, Math.min(top + height - h - 8, b.top - h - 10)) + 'px';
  };
  pop.addEventListener('mousedown', e => e.preventDefault());
  pop.addEventListener('click', e => {
    const k = e.target.closest('[data-pop]')?.dataset.pop; if (!k) return;
    const info = selInfo(); if (!info) return;
    if (k === 'bold') { document.execCommand('bold'); sync(info.f); onSel(); return; }
    const a = { id: uid(), path: info.f.dataset.path, start: info.start, end: info.end, quote: info.quote, note: '', color: COLORS[0], created: Date.now() };
    doc.annotations.push(a);
    getSelection().removeAllRanges(); pop.hidden = true;
    paint(); onAnnotations(false); onActivate(a.id, 'new'); onChange();
  });
  const onScroll = () => { if (!pop.hidden) onSel(); };

  if (editable) {
  host.addEventListener('input', onInput);
  host.addEventListener('keydown', onKey);
  host.addEventListener('paste', onPaste);
  document.addEventListener('selectionchange', onSel);
  document.addEventListener('scroll', onScroll, true);
  window.visualViewport?.addEventListener('resize', onScroll);
  window.visualViewport?.addEventListener('scroll', onScroll);
  }
  host.addEventListener('click', onClick);

  render();
  return {
    render: () => { render(); onAnnotations(false); },
    paint, highlight, scrollTo, removeAnnotation, order,
    destroy() {
      ro?.disconnect(); pop.remove();
      document.removeEventListener('selectionchange', onSel); document.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', onScroll); window.visualViewport?.removeEventListener('scroll', onScroll);
    },
  };
}
