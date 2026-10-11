const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function harness(kind, overrides = {}) {
  const messages = [],
    attachments = [],
    presses = [],
    checks = [];
  const state = {
    value: true,
    focused: true,
    attachFailures: 0,
    releaseFailures: 0,
    ...overrides,
  };
  const tab = { id: 1, active: true, windowId: 1, url: 'https://example.com/' };
  const rule = {
    id: 'rule',
    enabled: true,
    ruleType: kind,
    expression: 'true',
    builtinId: 'test',
    textMatch: 'ready',
    urlMatch: '',
    x: 313,
    y: 350,
    gridSize: 3,
    step: 10,
    intervalMs: 30,
    visualize: false,
  };
  const sender = {
    tab: { id: 1 },
    frameId: 0,
    documentId: 'document-1',
    url: tab.url,
  };
  const message =
    kind === 'text'
      ? { type: 'AUTO_TEXT_FOUND', textMatch: 'ready' }
      : { type: 'CHECK_EXPRESSION_RULES' };
  const event = { addListener() {} };
  const evaluate = (target) => {
    checks.push(target);
    return state.value;
  };
  const chrome = {
    runtime: {
      onInstalled: event,
      onMessage: { addListener: (f) => messages.push(f) },
      getManifest: () => ({ version: 'test' }),
    },
    tabs: {
      onActivated: event,
      onUpdated: event,
      onRemoved: event,
      get: async () => tab,
      sendMessage: async (id, message, options) => ({
        present: evaluate(options) === true,
      }),
    },
    windows: {
      onFocusChanged: event,
      get: async () => ({ focused: state.focused }),
    },
    storage: {
      local: { get: async () => ({ autoRules: [rule] }), set: async () => {} },
    },
    scripting: {
      executeScript: async ({ target }) => [
        { documentId: sender.documentId, result: evaluate(target) },
      ],
    },
    userScripts: {
      configureWorld: async () => {},
      execute: async ({ world, target }) => [
        {
          documentId: sender.documentId,
          result:
            world === 'USER_SCRIPT'
              ? 'function () { return true; }'
              : evaluate(target),
        },
      ],
    },
    debugger: {
      attach: async () => {
        if (state.attachFailures > 0) {
          state.attachFailures--;
          throw new Error('Not ready');
        }
        attachments.push('attach');
        state.onAttach?.();
      },
      detach: async () => {
        attachments.push('detach');
      },
      sendCommand: async (target, method, args) => {
        if (args.type === 'mousePressed') {
          presses.push({ x: args.x, y: args.y });
          state.value = false;
        }
        if (args.type === 'mouseReleased' && state.releaseFailures > 0) {
          state.releaseFailures--;
          throw new Error('Release failed');
        }
      },
    },
  };
  const context = vm.createContext({
    chrome,
    setTimeout: (f) => f(),
    console: { log() {}, warn() {}, error() {} },
  });
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(
        fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'),
        context,
      );
    }
  };
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'),
    context,
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const notify = () =>
    messages.forEach((listener) => listener(message, sender, () => {}));
  const poll = async () => {
    notify();
    await flush();
  };
  return {
    state,
    tab,
    rule,
    sender,
    checks,
    presses,
    attachments,
    notify,
    poll,
    flush,
  };
}
for (const kind of ['text', 'expression', 'bundled']) {
  test(`${kind}: retries false checks, stops when condition disappears, and fires once`, async () => {
    const h = harness(kind, { value: false });
    await h.poll();
    assert.deepEqual(h.attachments, []);
    h.state.value = true;
    await h.poll();
    assert.equal(h.presses.length, 1);
    assert.deepEqual(h.attachments, ['attach', 'detach']);
    h.state.value = true;
    await h.poll();
    assert.equal(h.presses.length, 1);
  });
  test(`${kind}: failed first attachment retries`, async () => {
    const h = harness(kind, { attachFailures: 1 });
    await h.poll();
    assert.equal(h.presses.length, 0);
    await h.poll();
    assert.equal(h.presses.length, 1);
  });
  test(`${kind}: simultaneous notifications produce one sweep`, async () => {
    const h = harness(kind);
    h.notify();
    h.notify();
    h.notify();
    await h.flush();
    assert.equal(h.presses.length, 1);
    assert.deepEqual(h.attachments, ['attach', 'detach']);
  });
  test(`${kind}: navigation during attachment stops clicks and detaches`, async () => {
    const h = harness(kind);
    h.state.onAttach = () => {
      h.tab.url = 'https://example.com/next';
    };
    await h.poll();
    assert.equal(h.presses.length, 0);
    assert.deepEqual(h.attachments, ['attach', 'detach']);
  });
  test(`${kind}: losing focus before clicking stops and permits retry`, async () => {
    const h = harness(kind);
    h.state.onAttach = () => {
      h.state.focused = false;
    };
    await h.poll();
    assert.equal(h.presses.length, 0);
    h.state.onAttach = null;
    h.state.focused = true;
    await h.poll();
    assert.equal(h.presses.length, 1);
  });
  test(`${kind}: failure after a mouse press never repeats that click`, async () => {
    const h = harness(kind, { releaseFailures: 1 });
    await h.poll();
    h.state.value = true;
    await h.poll();
    assert.equal(h.presses.length, 1);
    assert.deepEqual(h.attachments, ['attach', 'detach']);
  });
}
test('text: iframe checks stay bound to the originating document', async () => {
  const h = harness('text');
  h.sender.frameId = 2;
  h.sender.url = 'https://iframe.example/';
  await h.poll();
  assert.equal(h.presses.length, 1);
  assert.ok(h.checks.every((target) => target.documentId === 'document-1'));
});
for (const kind of ['expression', 'bundled']) {
  test(`${kind}: returned coordinates override saved center`, async () => {
    const h = harness(kind, { value: { x: 55, y: 110 } });
    await h.poll();
    assert.deepEqual(h.presses, [{ x: 55, y: 110 }]);
    assert.ok(
      h.checks.every((target) => target.documentIds[0] === 'document-1'),
    );
  });
  test(`${kind}: iframe notifications cannot trigger top-level JS`, async () => {
    const h = harness(kind);
    h.sender.frameId = 2;
    await h.poll();
    assert.deepEqual(h.attachments, []);
  });
}
