// Minimal inline markdown: only **bold** is meaningful in resume text.
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function mdToHtml(md) {
  return esc(md).replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
}

export function mdToPlain(md) { return String(md ?? '').replace(/\*\*/g, ''); }

/** Serialize an edited field back to markdown. Also returns mark offsets (plain-text coordinates). */
export function domToMd(root) {
  let md = '', plain = 0;
  const marks = {};
  const walk = (node, bold) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\u00a0/g, ' ').replace(/\n/g, '');
        md += bold ? t.replace(/\*\*/g, '') : t; plain += t.length;
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') continue;
      const w = parseInt(n.style && n.style.fontWeight);
      const isBold = tag === 'B' || tag === 'STRONG' || w >= 600;
      const isMark = tag === 'MARK' && n.dataset.aid;
      const start = plain;
      if (isBold && !bold) { md += '**'; walk(n, true); md += '**'; }
      else walk(n, bold);
      if (isMark) {
        const id = n.dataset.aid;
        marks[id] = marks[id] ? { start: Math.min(marks[id].start, start), end: Math.max(marks[id].end, plain) } : { start, end: plain };
      }
    }
  };
  walk(root, false);
  md = md.replace(/\*\*\*\*/g, '').replace(/\*\*(\s*)\*\*/g, '$1');
  return { md, marks };
}
