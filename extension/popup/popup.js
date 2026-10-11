const $ = (sel, root = document) => root.querySelector(sel);
const store = $('#rules');
async function getTargetTab() {
  const browserWindow = await chrome.windows.getLastFocused({
    windowTypes: ['normal'],
  });
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId: browserWindow.id,
  });
  return tab;
}
const values = Array.from({ length: 20 }, (_, index) => index + 1);
function populateSizes(select, value = 1) {
  for (const size of values) {
    const option = document.createElement('option');
    option.value = size;
    option.textContent =
      size === 1 ? 'Single click' : `${size} × ${size} (${size * size} clicks)`;
    select.append(option);
  }
  select.value = String(value);
}
function configureGridFields(root) {
  const size = root.querySelector('[name="gridSize"]');
  const update = () => {
    const count = Number(size.value);
    root.querySelector('.grid-options').hidden = count === 1;
    root.querySelector('.grid-summary').textContent =
      count === 1
        ? 'One click at the center.'
        : `${count * count} clicks, starting nearest the center.`;
    for (const name of ['step', 'intervalMs']) {
      root.querySelector(`[name="${name}"]`).disabled =
        Number(size.value) === 1;
    }
  };
  size.addEventListener('change', update);
  update();
}
populateSizes($('#manual .sizes'));
configureGridFields($('#manual'));
function createRule(rule = {}) {
  const node = $('#rule-template').content.firstElementChild.cloneNode(true);
  node.dataset.id = rule.id || crypto.randomUUID();
  node.dataset.new = String(!rule.id || !!rule._open);
  populateSizes(
    $('.sizes', node),
    rule.gridSize ??
      (rule.radius != null ? 2 * rule.radius + 1 : rule.id ? 13 : 1),
  );
  for (const key of [
    'enabled',
    'urlMatch',
    'textMatch',
    'ruleType',
    'expression',
    'x',
    'y',
    'step',
    'intervalMs',
    'visualize',
  ]) {
    const field = node.querySelector(`[name="${key}"]`);
    if (rule[key] !== undefined) {
      if (field.type === 'checkbox') field.checked = rule[key];
      else field.value = rule[key];
    }
  }
  configureGridFields(node);
  const updateRuleType = () => {
    const expression = $('[name="ruleType"]', node).value === 'expression';
    $('.expression-field', node).hidden = !expression;
    $('.text-field', node).hidden = expression;
    $('[name="expression"]', node).disabled = !expression;
    $('[name="textMatch"]', node).disabled = expression;
    node.querySelectorAll('[data-js-only]').forEach((element) => {
      element.hidden = !expression;
    });
    $('.position-heading', node).textContent = expression
      ? 'Saved center · fallback'
      : 'Click center';
    $('.position-help', node).textContent = expression
      ? 'Used only when your code returns true. A returned { x, y } sets the center instead; these fields can be blank.'
      : 'Viewport coordinates. The grid starts at the center and expands outward.';
  };
  $('[name="ruleType"]', node).addEventListener('change', updateRuleType);
  updateRuleType();
  $('.remove', node).addEventListener('click', () => {
    removedRule = { node, next: node.nextSibling };
    node.remove();
    $('#undo-row').hidden = false;
    markDirty();
  });
  $('.pick-rule', node).addEventListener('click', () => pickRulePosition(node));
  store.append(node);
  return node;
}
let removedRule = null;
function markDirty() {
  $('#save-state').textContent = 'Unsaved changes';
  $('#save-state').dataset.dirty = 'true';
  $('#save-rules').disabled = false;
  $('#status').textContent = '';
}
function clearFieldErrors() {
  store.querySelectorAll('.field-error').forEach((element) => element.remove());
  store.querySelectorAll('[aria-invalid]').forEach((element) => {
    element.removeAttribute('aria-invalid');
    element.removeAttribute('aria-describedby');
  });
}
store.addEventListener('input', () => {
  clearFieldErrors();
  markDirty();
});
store.addEventListener('change', () => {
  clearFieldErrors();
  markDirty();
});
$('#save-rules').addEventListener('click', saveRules);
$('#undo-remove').addEventListener('click', () => {
  if (!removedRule) return;
  store.insertBefore(
    removedRule.node,
    removedRule.next?.parentNode === store ? removedRule.next : null,
  );
  removedRule = null;
  $('#undo-row').hidden = true;
  markDirty();
});
function showFieldError(node, fieldName, message) {
  const field = node.querySelector(`[name="${fieldName}"]`);
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute(
    'aria-describedby',
    `${node.dataset.id}-${fieldName}-error`,
  );
  const error = document.createElement('p');
  error.className = 'field-error';
  error.id = `${node.dataset.id}-${fieldName}-error`;
  error.textContent = message;
  field.closest('label').append(error);
}
function didSaveRules() {
  $('#save-state').textContent = 'All changes saved';
  $('#save-state').dataset.dirty = 'false';
  $('#save-rules').disabled = true;
  $('#undo-row').hidden = true;
  removedRule = null;
}
function readRule(node) {
  const get = (name) => node.querySelector(`[name="${name}"]`);
  return {
    id: node.dataset.id,
    enabled: get('enabled').checked,
    urlMatch: get('urlMatch').value.trim(),
    textMatch: get('textMatch').value.trim(),
    ruleType: get('ruleType').value,
    expression: get('expression').value.trim(),
    x: get('x').value.trim() ? Number(get('x').value) : null,
    y: get('y').value.trim() ? Number(get('y').value) : null,
    gridSize: Number(get('gridSize').value),
    step: Number(get('gridSize').value) === 1 ? 10 : Number(get('step').value),
    intervalMs:
      Number(get('gridSize').value) === 1
        ? 180
        : Number(get('intervalMs').value),
    visualize: get('visualize').checked,
  };
}
async function saveRules() {
  clearFieldErrors();
  const rules = [...store.children].map(readRule);
  for (const [index, r] of rules.entries()) {
    const expressionRule = r.ruleType === 'expression';
    const issues = [];
    if (!(expressionRule ? r.expression : r.textMatch)) {
      issues.push([
        expressionRule ? 'expression' : 'textMatch',
        expressionRule ? 'Enter JavaScript code.' : 'Enter page text to match.',
      ]);
    }
    // JS coordinate objects override these fields. Validate fallback coordinates
    // when the evaluator returns true, rather than blocking expression edits.
    if (!expressionRule) {
      for (const name of ['x', 'y']) {
        if (!Number.isFinite(r[name]) || r[name] < 0)
          issues.push([
            name,
            `${name.toUpperCase()} must be a nonnegative number.`,
          ]);
      }
    }
    for (const [name, min, max, label] of [
      ['gridSize', 1, 20, 'Grid size'],
      ['step', 1, 100, 'Spacing'],
      ['intervalMs', 0, 5000, 'Delay'],
    ]) {
      if (!Number.isInteger(r[name]) || r[name] < min || r[name] > max)
        issues.push([
          name,
          `${label} must be a whole number from ${min} to ${max}.`,
        ]);
    }
    if (issues.length) {
      const [fieldName, message] = issues[0];
      $('#status').dataset.tone = 'error';
      $('#status').textContent = `Rule ${index + 1}: ${message}`;
      const invalid = store.children[index];
      const details = invalid?.querySelector('details');
      if (details) details.open = true;
      showFieldError(invalid, fieldName, message);
      invalid?.querySelector(`[name="${fieldName}"]`)?.focus();
      return;
    }
  }
  try {
    await chrome.storage.local.set({ autoRules: rules, rulesDraft: null });
    didSaveRules();
    $('#status').dataset.tone = 'success';
    $('#status').textContent = '';
    $('#save-state').textContent = rules.length
      ? `${rules.length} ${rules.length === 1 ? 'rule' : 'rules'} saved`
      : 'All rules removed';
  } catch (error) {
    $('#status').dataset.tone = 'error';
    $('#status').textContent = `Could not save rules: ${error.message}`;
  }
}
$('#add').addEventListener('click', async () => {
  await rulesReady;
  let urlMatch = '';
  try {
    const tab = await getTargetTab();
    const url = new URL(tab?.url);
    if (url.protocol === 'https:' || url.protocol === 'http:')
      urlMatch = url.hostname;
  } catch {
    /* Leave the URL editable when the current page has no web domain. */
  }
  createRule({ urlMatch });
  markDirty();
  requestAnimationFrame(() => {
    const field = store.lastElementChild?.querySelector('[name="urlMatch"]');
    field?.focus();
  });
});
const rulesReady = chrome.storage.local
  .get(['autoRules', 'autoRule', 'rulesDraft'])
  .then((v) => {
    const rules =
      v.rulesDraft?.rules ||
      v.autoRules ||
      (v.autoRule ? [{ ...v.autoRule, id: 'legacy' }] : []);
    rules.forEach(createRule);
    if (v.rulesDraft) markDirty();
    if (v.rulesDraft?.picked) {
      $('#status').dataset.tone = 'success';
      $('#status').textContent =
        'Rule position picked. Review your changes, then save rules.';
    }
  });
$('#manual').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const get = (name) => form.elements.namedItem(name);
  try {
    const tab = await getTargetTab();
    if (!tab?.id) {
      $('#status').dataset.tone = 'error';
      $('#status').textContent = 'No active tab found.';
      return;
    }
    const message = {
      type: 'CLICK_GRID',
      tabId: tab.id,
      x: Number(get('x').value),
      y: Number(get('y').value),
      gridSize: Number(get('gridSize').value),
      step: Number(get('step').value),
      intervalMs: Number(get('intervalMs').value),
      visualize: get('visualize').checked,
    };
    const result = await chrome.runtime.sendMessage(message);
    if (result?.ok) window.close();
    else {
      $('#status').dataset.tone = 'error';
      $('#status').textContent =
        result?.error || 'Could not run clicks. Try again.';
    }
  } catch (error) {
    $('#status').dataset.tone = 'error';
    $('#status').textContent = `Could not run clicks: ${error.message}`;
  }
});

// The popup closes while picking; retain the test setup for this tab.
const manualFields = ['x', 'y', 'gridSize', 'step', 'intervalMs', 'visualize'];
const manualReady = (async () => {
  const tab = await getTargetTab();
  const { manualDraft, rulesDraft } = await chrome.storage.local.get([
    'manualDraft',
    'rulesDraft',
  ]);
  if (!manualDraft || manualDraft.tabId !== tab?.id) return;
  for (const name of manualFields) {
    const field = $('#manual').elements.namedItem(name);
    if (manualDraft[name] === undefined) continue;
    if (field.type === 'checkbox') field.checked = manualDraft[name];
    else field.value = manualDraft[name];
  }
  $('#manual [name="gridSize"]').dispatchEvent(new Event('change'));
  if (manualDraft.picked && !rulesDraft) {
    $('.panel').open = true;
    $('#status').dataset.tone = 'success';
    $('#status').textContent =
      `Position picked: X ${manualDraft.x}, Y ${manualDraft.y}. Ready to test.`;
  }
})().catch(() => {});
$('#pick-position').addEventListener('click', async () => {
  const button = $('#pick-position');
  button.disabled = true;
  try {
    await manualReady;
    const tab = await getTargetTab();
    if (!tab?.id) throw new Error('No active tab found.');
    const draft = { tabId: tab.id, picked: false };
    for (const name of manualFields) {
      const field = $('#manual').elements.namedItem(name);
      draft[name] = field.type === 'checkbox' ? field.checked : field.value;
    }
    await chrome.storage.local.set({
      manualDraft: draft,
      pickerTarget: { type: 'manual', tabId: tab.id },
    });
    const result = await chrome.runtime.sendMessage({
      type: 'PICK_POINT',
      tabId: tab.id,
    });
    if (!result?.ok) throw new Error(result?.error || 'Picker unavailable.');
    window.close();
  } catch (error) {
    $('#status').dataset.tone = 'error';
    $('#status').textContent = `Could not pick a position: ${error.message}`;
    $('.panel').open = true;
  } finally {
    button.disabled = false;
  }
});

async function pickRulePosition(node) {
  const button = $('.pick-rule', node);
  button.disabled = true;
  try {
    await Promise.all([rulesReady, manualReady]);
    const tab = await getTargetTab();
    if (!tab?.id) throw new Error('No active tab found.');
    // Preserve raw values, including incomplete fields, without enabling drafts.
    const rules = [...store.children].map((ruleNode) => {
      const rule = {
        id: ruleNode.dataset.id,
        _open: !!ruleNode.querySelector('details')?.open,
      };
      for (const field of ruleNode.querySelectorAll('[name]')) {
        rule[field.name] =
          field.type === 'checkbox' ? field.checked : field.value;
      }
      return rule;
    });
    await chrome.storage.local.set({
      rulesDraft: {
        rules,
        tabId: tab.id,
        ruleId: node.dataset.id,
        picked: false,
      },
      pickerTarget: { type: 'rule', tabId: tab.id, ruleId: node.dataset.id },
    });
    const result = await chrome.runtime.sendMessage({
      type: 'PICK_POINT',
      tabId: tab.id,
    });
    if (!result?.ok) throw new Error(result?.error || 'Picker unavailable.');
    window.close();
  } catch (error) {
    $('#status').dataset.tone = 'error';
    $('#status').textContent = `Could not pick a position: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}

// Show the actual execution source and coordinates, including across popup closure.
function showLastSweep(sweep) {
  const label = $('#last-sweep');
  if (!sweep) return;
  const source =
    sweep.type === 'expression'
      ? 'JS rule'
      : sweep.type === 'text'
        ? 'Text rule'
        : 'Manual';
  $('.run-history').hidden = false;
  label.textContent = `Last click: ${source} · center (${sweep.center.x}, ${sweep.center.y}) · first click (${sweep.firstPoint.x}, ${sweep.firstPoint.y}) · v${sweep.version}`;
  label.title = sweep.ruleId ? `Rule ${sweep.ruleId}` : 'Manual test panel';
}
chrome.storage.local
  .get('lastSweep')
  .then(({ lastSweep }) => showLastSweep(lastSweep));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.lastSweep)
    showLastSweep(changes.lastSweep.newValue);
});
$('.footer').textContent += ` · v${chrome.runtime.getManifest().version}`;
