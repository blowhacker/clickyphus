const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const popup = fs.readFileSync(
  path.join(__dirname, '../extension/popup/popup.js'),
  'utf8',
);
const saveCode = popup.slice(
  popup.indexOf('function readRule('),
  popup.indexOf("$('#add').addEventListener"),
);

async function save(fields) {
  const defaults = {
    enabled: true,
    ruleType: 'expression',
    expression: 'return { x: 313, y: 350 };',
    urlMatch: '',
    textMatch: '',
    x: '',
    y: '',
    gridSize: '1',
    step: '10',
    intervalMs: '180',
    visualize: false,
  };
  const values = { ...defaults, ...fields };
  const status = { dataset: {}, textContent: '' };
  const details = { open: false };
  let focused;
  const node = {
    dataset: {
      id: 'rule',
      builtinId: values.builtinId || '',
      name: values.name || '',
    },
    querySelector(selector) {
      if (selector === 'details') return details;
      const name = selector.match(/name="([^"]+)"/)[1];
      return {
        value: String(values[name] ?? ''),
        checked: values[name],
        focus() {
          focused = name;
        },
      };
    },
  };
  let saved;
  const context = vm.createContext({
    clearFieldErrors() {},
    showFieldError() {},
    didSaveRules() {},
    store: { children: [node] },
    $: () => status,
    chrome: {
      storage: {
        local: {
          set: async (value) => {
            saved = value;
          },
        },
      },
    },
  });
  vm.runInContext(saveCode, context);
  await context.saveRules();
  return { saved, status, focused, details };
}

test('JS code saves with empty X/Y and no page text', async () => {
  const { saved, status } = await save({});
  assert.equal(status.dataset.tone, 'success');
  assert.equal(saved.autoRules[0].x, null);
  assert.equal(saved.autoRules[0].y, null);
});

test('fractional fallback coordinates save', async () => {
  const { saved } = await save({ x: '12.5', y: '34.5' });
  assert.equal(saved.autoRules[0].x, 12.5);
});

test('missing JavaScript code identifies and focuses its field', async () => {
  const { saved, status, focused, details } = await save({ expression: '' });
  assert.equal(saved, undefined);
  assert.equal(status.textContent, 'Rule 1: Enter JavaScript code.');
  assert.equal(focused, 'expression');
  assert.equal(details.open, true);
});

test('invalid shared settings identify the exact field', async () => {
  const { status, focused } = await save({ gridSize: '3', step: '' });
  assert.equal(
    status.textContent,
    'Rule 1: Spacing must be a whole number from 1 to 100.',
  );
  assert.equal(focused, 'step');
});

test('text rules still require saved coordinates', async () => {
  const { status, focused } = await save({
    ruleType: 'text',
    textMatch: 'Ready',
  });
  assert.equal(status.textContent, 'Rule 1: X must be a nonnegative number.');
  assert.equal(focused, 'x');
});

test('single-click rules ignore unused spacing and delay', async () => {
  const { saved, status } = await save({ step: '', intervalMs: '1.5' });
  assert.equal(status.dataset.tone, 'success');
  assert.equal(saved.autoRules[0].gridSize, 1);
});

test('multi-click grids still validate delay', async () => {
  const { saved, status, focused } = await save({
    gridSize: '3',
    intervalMs: '1.5',
  });
  assert.equal(saved, undefined);
  assert.equal(
    status.textContent,
    'Rule 1: Delay must be a whole number from 0 to 5000.',
  );
  assert.equal(focused, 'intervalMs');
});

for (const intervalMs of ['0', '30']) {
  test(`grid saves with ${intervalMs} ms delay`, async () => {
    const { saved, status } = await save({ gridSize: '3', intervalMs });
    assert.equal(status.dataset.tone, 'success');
    assert.equal(saved.autoRules[0].intervalMs, Number(intervalMs));
  });
}

test('bundled rule saves with empty expression, text, and fallback while retaining its identity', async () => {
  const { saved } = await save({
    ruleType: 'bundled',
    expression: '',
    builtinId: 'example-js-target',
    name: 'Example',
  });
  assert.equal(saved.autoRules[0].builtinId, 'example-js-target');
  assert.equal(saved.autoRules[0].name, 'Example');
  assert.equal(saved.autoRules[0].x, null);
});
