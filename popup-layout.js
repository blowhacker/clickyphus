// Presentation-only enhancement: retain all existing fields and handlers in popup.js.
// Each rule becomes a single expandable row; the original form remains inside it.
(() => {
  const container = document.getElementById('rules');
  if (!container) return;

  function compact(rule) {
    if (rule.dataset.compact === '1') return;
    rule.dataset.compact = '1';

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.className = 'rule-summary';
    const heading = document.createElement('span');
    heading.className = 'rule-title';
    const meta = document.createElement('span');
    meta.className = 'rule-meta';
    title.append(heading, meta);
    details.open = rule.dataset.new === 'true';
    const editor = document.createElement('div');
    editor.className = 'rule-editor';

    // Preserve the original enable checkbox and its existing change handlers.
    const checkbox = rule.querySelector('input[name="enabled"]');
    if (checkbox) {
      const label = checkbox.closest('label');
      if (label) {
        label.classList.add('rule-enabled');
        label.textContent = '';
        label.append(checkbox);
        label.title = 'Enable/disable this rule';
        checkbox.setAttribute('aria-label', 'Enable rule');
        summary.append(label);
        // Clicking the checkbox should not also expand/collapse the row.
        label.addEventListener('click', e => e.stopPropagation());
      }
    }

    summary.append(title);
    while (rule.firstChild) editor.append(rule.firstChild);
    details.append(summary, editor);
    rule.append(details);

    const update = () => {
      const get = name => rule.querySelector(`[name="${name}"]`)?.value?.trim() || '';
      const url = get('urlMatch') || '(set URL)';
      const phrase = get('textMatch') || '(set text)';
      const size = get('gridSize') || '?';
      const x = get('x') || '?';
      const y = get('y') || '?';
      heading.textContent = url === '(set URL)' ? 'New rule · add a URL' : url;
      meta.textContent = `${phrase} · ${size}×${size} at ${x}, ${y}`;
      rule.dataset.enabled = String(checkbox.checked);
      title.title = title.textContent;
    };
    rule.addEventListener('input', update);
    rule.addEventListener('change', update);
    update();
  }

  function sync() { container.querySelectorAll('.rule').forEach(compact); }
  const observer = new MutationObserver(sync);
  observer.observe(container, { childList: true });
  sync();
})();
