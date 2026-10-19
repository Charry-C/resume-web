// Keep dialogs inside the visible area, including when a mobile keyboard opens.
let viewportFrame;
function syncViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement.style;
    root.setProperty('--viewport-width', (viewport?.width ?? innerWidth) + 'px');
    root.setProperty('--viewport-height', (viewport?.height ?? innerHeight) + 'px');
    root.setProperty('--viewport-left', (viewport?.offsetLeft ?? 0) + 'px');
    root.setProperty('--viewport-top', (viewport?.offsetTop ?? 0) + 'px');
    const focused = document.activeElement;
    if (focused?.closest('dialog[open] .modal-body, dialog[open] .sheet-content')) {
      requestAnimationFrame(() => focused.isConnected && focused.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    }
  });
}
syncViewport();
addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('resize', syncViewport);
window.visualViewport?.addEventListener('scroll', syncViewport);

export function openDialog(dialog) {
  const form = dialog.querySelector(':scope > .modal-card');
  if (form && !form.querySelector(':scope > .modal-body')) {
    const body = document.createElement('div');
    body.className = 'modal-body';
    [...form.children].filter(child => child.tagName !== 'FOOTER').forEach(child => body.append(child));
    form.prepend(body);
  }
  const heading = dialog.querySelector('h3');
  if (heading) {
    heading.id = `${dialog.id}Title`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  if (!dialog.querySelector(':scope > .modal-close')) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn icon ghost modal-close';
    close.setAttribute('aria-label', `关闭${heading?.textContent || '弹窗'}`);
    close.textContent = '×';
    close.onclick = () => dialog.close();
    dialog.append(close);
  }
  if (!dialog.open) dialog.showModal();
}
