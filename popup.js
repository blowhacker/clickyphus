const $ = (sel, root=document) => root.querySelector(sel);
const store = $('#rules');
const values = [1,3,5,7,9,11,13,15,17,19,20];
function populateSizes(select, value=3) {
  for (const size of values) {
    const option = document.createElement('option');
    option.value = size;
    option.textContent = size === 1 ? '1 × 1 (single)' : `${size} × ${size} (${size*size} clicks)`;
    select.append(option);
  }
  select.value = String(value);
}
populateSizes($('#manual .sizes'));
function createRule(rule={}) {
  const node = $('#rule-template').content.firstElementChild.cloneNode(true);
  node.dataset.id = rule.id || crypto.randomUUID();
  populateSizes($('.sizes', node), rule.gridSize ?? (rule.radius != null ? 2*rule.radius+1 : 3));
  for (const key of ['enabled','urlMatch','textMatch','x','y','step','intervalMs','visualize']) {
    const field = node.querySelector(`[name="${key}"]`);
    if (rule[key] !== undefined) {
      if (field.type === 'checkbox') field.checked = rule[key];
      else field.value = rule[key];
    }
  }
  $('.remove',node).addEventListener('click', async () => { node.remove(); await saveRules(); });
  $('.save',node).addEventListener('click', saveRules);
  store.append(node);
}
function readRule(node) {
  const get = name => node.querySelector(`[name="${name}"]`);
  return {
    id:node.dataset.id, enabled:get('enabled').checked,
    urlMatch:get('urlMatch').value.trim(), textMatch:get('textMatch').value.trim(),
    x:Number(get('x').value), y:Number(get('y').value),
    gridSize:Number(get('gridSize').value), step:Number(get('step').value),
    intervalMs:Number(get('intervalMs').value), visualize:get('visualize').checked
  };
}
async function saveRules() {
  const rules = [...store.children].map(readRule);
  for (const r of rules) {
    if (!r.urlMatch || !r.textMatch || !Number.isInteger(r.x) || r.x < 0 ||
      !Number.isInteger(r.y) || r.y < 0 || r.step < 1 || r.step > 100 ||
      r.intervalMs < 80 || r.intervalMs > 5000) {
      $('#status').textContent = 'Fill in each rule’s URL, text and valid numeric fields.';
      return;
    }
  }
  await chrome.storage.local.set({autoRules:rules});
  $('#status').textContent = `Saved ${rules.length} rule(s).`;
}
$('#add').addEventListener('click', () => createRule());
chrome.storage.local.get(['autoRules','autoRule']).then(v => {
  const rules = v.autoRules || (v.autoRule ? [{...v.autoRule,id:'legacy'}] : []);
  rules.forEach(createRule);
});
$('#manual').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const get = name => form.elements.namedItem(name);
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id) { $('#status').textContent='No tab found'; return; }
  const message = {
    type:'CLICK_GRID',tabId:tab.id,x:Number(get('x').value),y:Number(get('y').value),
    gridSize:Number(get('gridSize').value),step:Number(get('step').value),
    intervalMs:Number(get('intervalMs').value),visualize:get('visualize').checked
  };
  const result = await chrome.runtime.sendMessage(message);
  if (result?.ok) window.close();
  else $('#status').textContent = result?.error || 'Failed';
});
