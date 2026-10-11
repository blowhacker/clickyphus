const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function watcher(readyState, { text = false, failMessage = false } = {}) {
  const timers = [];
  const messages = [];
  const events = {};
  const document = {
    readyState,
    body: {},
    createTreeWalker: () => {
      let read = false;
      return {
        nextNode: () => {
          if (read) return null;
          read = true;
          return {
            nodeType: 3,
            nodeValue: 'Ready',
            parentElement: { closest: () => false },
          };
        },
      };
    },
    addEventListener: (name, handler) => {
      events[name] = handler;
    },
  };
  const window = {
    addEventListener: (name, handler) => {
      events[name] = handler;
    },
  };
  window.top = window;
  const context = {
    document,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    window,
    location: { href: 'https://example.com' },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
    setInterval: (fn) => {
      events.poll = fn;
    },
    MutationObserver: class {
      constructor(callback) {
        events.mutation = callback;
      }
      observe(target, options) {
        events.observerOptions = options;
      }
    },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          messages.push(message);
          if (failMessage) throw new Error('Worker unavailable');
        },
      },
      storage: {
        local: {
          get: async () => ({
            autoRules: [
              text
                ? { enabled: true, ruleType: 'text', textMatch: 'Ready' }
                : {
                    enabled: true,
                    ruleType: 'expression',
                    expression: 'false',
                  },
            ],
          }),
        },
        onChanged: { addListener() {} },
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync('extension/content/watcher.js', 'utf8'),
    context,
  );
  await Promise.resolve();
  return { document, events, timers, messages };
}

test('waits for DOM readiness, then retries while resources are still loading', async () => {
  const state = await watcher('loading');
  state.events.poll();
  assert.equal(state.messages.length, 0);
  assert.equal(state.timers.length, 0);
  state.document.readyState = 'interactive';
  state.events.DOMContentLoaded();
  assert.deepEqual(
    state.timers.map((timer) => timer.delay),
    [450, 1000, 2000],
  );
  for (const timer of state.timers) timer.fn();
  assert.equal(state.messages.length, 3);
  state.events.poll();
  assert.equal(state.messages.length, 4);
});

test('starts checks when injected after DOM readiness and checks again on load', async () => {
  const state = await watcher('interactive');
  for (const timer of state.timers.splice(0)) timer.fn();
  assert.equal(state.messages.length, 3);
  state.document.readyState = 'complete';
  state.events.load();
  state.timers.shift().fn();
  assert.equal(state.messages.length, 4);
});

for (const failMessage of [false, true]) {
  test(`text match retries after a skipped or failed first notification (${failMessage})`, async () => {
    const state = await watcher('interactive', { text: true, failMessage });
    state.events.poll();
    state.events.poll();
    assert.equal(state.messages.length, 1, 'coalesces in-flight notifications');
    await new Promise((resolve) => setImmediate(resolve));
    state.events.poll();
    assert.equal(
      state.messages.length,
      2,
      'retries instead of permanently suppressing text',
    );
  });
}

test('restored pages start fresh checks without needing a reload', async () => {
  const state = await watcher('complete');
  for (const timer of state.timers.splice(0)) timer.fn();
  state.events.pageshow();
  assert.deepEqual(
    state.timers.map((timer) => timer.delay),
    [450, 1000, 2000],
  );
});

test('attribute-only readiness changes schedule a check before the next polling tick', async () => {
  const state = await watcher('complete');
  for (const timer of state.timers.splice(0)) timer.fn();
  assert.equal(state.events.observerOptions.attributes, true);
  const before = state.messages.length;
  state.events.mutation([{ type: 'attributes', attributeName: 'hidden' }]);
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].delay, 450);
  state.timers[0].fn();
  assert.equal(state.messages.length, before + 1);
});
