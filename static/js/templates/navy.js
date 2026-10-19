// 「墨蓝」— classic Chinese tech resume: navy section titles with a full rule,
// date | name | role rows, bold lead-ins on bullets. A4.
export default {
  id: 'navy',
  name: '墨蓝 · 经典',
  desc: '藏青标题与通栏细线，日期左、角色右，适合技术岗',
  css: 'css/tpl-navy.css',
  render(r, h) {
    const b = r.basics || {};
    const contacts = ['phone', 'email', 'location']
      .map(k => h.field(`basics.${k}`, b[k], { ph: { phone: '电话', email: '邮箱', location: '城市' }[k], cls: 'c' }))
      .filter(Boolean);
    const links = (b.links || []).map((l, i) => h.field(`basics.links.${i}.url`, l.url, { ph: '链接', cls: 'c' })).filter(Boolean);
    const head = (h.editable || b.name || b.title || contacts.length) ? `
      <header class="nv-head">
        <div class="nv-name-row">
          ${h.field('basics.name', b.name, { ph: '姓名', cls: 'nv-name' })}
          ${h.field('basics.title', b.title, { ph: '求职意向', cls: 'nv-title' })}
        </div>
        ${contacts.length || links.length ? `<div class="nv-contact">${[...contacts, ...links].join('<i class="dot"></i>')}</div>` : ''}
        ${h.field('basics.summary', b.summary, { ph: '一句话个人简介（可选）', cls: 'nv-summary', block: true })}
      </header>` : '';

    const sections = (r.sections || []).map((s, si) => {
      const P = `sections.${si}`;
      let body = '';
      if (s.type === 'entries') {
        body = s.items.map((it, ii) => {
          const p = `${P}.items.${ii}`;
          const date = [h.field(`${p}.start`, it.start, { ph: '开始', cls: 'd' }), h.field(`${p}.end`, it.end, { ph: '结束', cls: 'd' })].filter(Boolean).join('<span class="dash">-</span>');
          const details = (it.details || []).map((d, di) => `
            <p class="nv-detail">${h.field(`${p}.details.${di}.label`, d.label, { ph: '标签', cls: 'lbl' })}<span class="colon">：</span>${h.field(`${p}.details.${di}.text`, d.text, { ph: '内容' })}</p>`).join('');
          const bullets = (it.bullets || []).length ? `<ul class="nv-bullets">${it.bullets.map((x, bi) => `<li>${h.field(`${p}.bullets.${bi}`, x, { ph: '要点', bullet: true })}</li>`).join('')}</ul>` : '';
          return h.item(p, `
            <div class="nv-entry-head ${it.title || h.editable ? '' : 'no-title'}">
              <span class="nv-date">${date}</span>
              ${h.field(`${p}.title`, it.title, { ph: s.kind === 'education' ? '学校' : s.kind === 'project' ? '项目名称' : '公司 / 组织', cls: 'nv-org' })}
              ${h.field(`${p}.role`, it.role, { ph: s.kind === 'education' ? '学位 · 专业' : '职位 / 角色', cls: 'nv-role' })}
            </div>${details}${bullets}`, { kind: 'entry', cls: 'nv-entry' });
        }).join('');
      } else if (s.type === 'keyvalue') {
        body = `<ul class="nv-kv">${s.items.map((it, ii) => h.item(`${P}.items.${ii}`,
          `${h.field(`${P}.items.${ii}.label`, it.label, { ph: '标签', cls: 'lbl' })}<span class="colon">：</span>${h.field(`${P}.items.${ii}.text`, it.text, { ph: '内容' })}`, { tag: 'li', kind: 'kv' })).join('')}</ul>`;
      } else {
        body = `<ul class="nv-bullets">${s.items.map((it, ii) => h.item(`${P}.items.${ii}`, h.field(`${P}.items.${ii}`, it, { ph: '条目' }), { tag: 'li', kind: 'list' })).join('')}</ul>`;
      }
      return `<section class="nv-sec">
        <h2 class="nv-h">${h.field(`${P}.title`, s.title, { ph: '板块标题' })}</h2>
        ${body}${h.addButton(P, s.type)}
      </section>`;
    }).join('');
    return `<div class="tpl-navy">${head}${sections}</div>`;
  },
};
