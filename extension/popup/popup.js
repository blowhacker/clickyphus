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
const values = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 20];
function populateSizes(select, value = 13) {
  for (const size of values) {
    const option = document.createElement('option');
    option.value = size;
    option.textContent =
      size === 1
        ? '1 × 1 (single)'
        : `${size} × ${size} (${size * size} clicks)`;
    select.append(option);
  }
  select.value = String(value);
}
populateSizes($('#manual .sizes'));
function createRule(rule = {}) {
  const node = $('#rule-template').content.firstElementChild.cloneNode(true);
  node.dataset.id = rule.id || crypto.randomUUID();
  node.dataset.new = String(!rule.id || !!rule._open);
  populateSizes(
    $('.sizes', node),
    rule.gridSize ?? (rule.radius != null ? 2 * rule.radius + 1 : 13),
  );
  for (const key of [
    'enabled',
    'urlMatch',
    'textMatch',
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
  $('.remove', node).addEventListener('click', async () => {
    node.remove();
    await saveRules();
  });
  $('.save', node).addEventListener('click', saveRules);
  $('.pick-rule', node).addEventListener('click', () => pickRulePosition(node));
  store.append(node);
}
function readRule(node) {
  const get = (name) => node.querySelector(`[name="${name}"]`);
  return {
    id: node.dataset.id,
    enabled: get('enabled').checked,
    urlMatch: get('urlMatch').value.trim(),
    textMatch: get('textMatch').value.trim(),
    x: Number(get('x').value),
    y: Number(get('y').value),
    gridSize: Number(get('gridSize').value),
    step: Number(get('step').value),
    intervalMs: Number(get('intervalMs').value),
    visualize: get('visualize').checked,
  };
}
async function saveRules() {
  const rules = [...store.children].map(readRule);
  for (const r of rules) {
    if (
      !r.urlMatch ||
      !r.textMatch ||
      !Number.isInteger(r.x) ||
      r.x < 0 ||
      !Number.isInteger(r.y) ||
      r.y < 0 ||
      r.step < 1 ||
      r.step > 100 ||
      r.intervalMs < 80 ||
      r.intervalMs > 5000
    ) {
      $('#status').dataset.tone = 'error';
      $('#status').textContent =
        'Add a URL and page text to every rule, and check the numeric fields.';
      const invalid = [...store.children].find(
        (node) => readRule(node).id === r.id,
      );
      const details = invalid?.querySelector('details');
      if (details) details.open = true;
      return;
    }
  }
  try {
    await chrome.storage.local.set({ autoRules: rules, rulesDraft: null });
    $('#status').dataset.tone = 'success';
    $('#status').textContent = rules.length
      ? `Saved ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}.`
      : 'All rules removed.';
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
