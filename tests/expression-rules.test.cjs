const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../extension/background.js'),
  'utf8',
);

async function runRule(
  expression,
  {
    gridSize = 1,
    visualize = false,
    x = 313,
    y = 350,
    step = 10,
    intervalMs = 80,
    userScripts = true,
    revoked = false,
    active = true,
    documentChanges = false,
    stopOnAttach = false,
    attachFailures = 0,
    releaseFailures = 0,
  } = {},
) {
  const listeners = [];
  const presses = [];
  const markers = [];
  const logs = [];
  const stored = {};
  const event = { addListener() {} };
  const page = vm.createContext(
    {},
    { codeGeneration: { strings: false, wasm: false } },
  );
  const compiler = vm.createContext({});
  const events = [];
  let attached = false;
  let evaluations = 0;
  vm.runInContext(
    `window = globalThis; ready = true; x = 55; y = 110; value = 'ready';
     rectBox = { getBoundingClientRect: () => ({ left: 40, top: 80, height: 60 }) };`,
    page,
  );
  const rule = {
    id: 'expression',
    enabled: true,
    ruleType: 'expression',
    expression,
    urlMatch: '',
    x,
    y,
    gridSize,
    step,
    intervalMs,
    visualize,
  };
  const tab = { active, windowId: 1, url: 'https://example.com/' };
  const chrome = {
    runtime: {
      onInstalled: event,
      getManifest: () => ({ version: '0.10.1' }),
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        },
      },
    },
    tabs: {
      onActivated: event,
      onUpdated: event,
      onRemoved: event,
      get: async () => tab,
    },
    windows: { onFocusChanged: event, get: async () => ({ focused: true }) },
    storage: {
      local: {
        get: async () => ({ autoRules: [rule] }),
        set: async (values) => Object.assign(stored, values),
      },
    },
    userScripts: userScripts
      ? {
          getScripts: async () => {
            if (revoked) throw new Error('Not allowed');
            return [];
          },
          configureWorld: async () => {
            if (revoked) throw new Error('Not allowed');
          },
          execute: async ({ target, world, js }) => {
            if (revoked) throw new Error('Not allowed');
            assert.deepEqual(Array.from(target.documentIds), [
              'original-document',
            ]);
            if (documentChanges && world === 'MAIN')
              throw new Error('Document no longer exists');
            events.push(world);
            if (world === 'MAIN') evaluations++;
            try {
              const result = vm.runInContext(
                js[0].code,
                world === 'MAIN' ? page : compiler,
                { timeout: 500 },
              );
              return [{ frameId: 0, documentId: 'original-document', result }];
            } catch (error) {
              return [
                {
                  frameId: 0,
                  documentId: 'original-document',
                  error: error.message,
                },
              ];
            }
          },
        }
      : undefined,
    debugger: {
      attach: async () => {
        if (attachFailures > 0) {
          attachFailures--;
          throw new Error('Tab not ready for attachment');
        }
        attached = true;
        events.push('attach');
        if (stopOnAttach) page.ready = false;
      },
      detach: async () => {
        attached = false;
        events.push('detach');
      },
      sendCommand: async (target, method, args) => {
        if (method === 'Runtime.evaluate') {
          if (args.expression.includes('__clickyphus_visualizer__')) {
            markers.push(args.expression);
            return {};
          }
          throw new Error('Conditions must not use debugger Runtime.evaluate');
        }
        if (args.type === 'mouseReleased' && releaseFailures > 0) {
          releaseFailures--;
          throw new Error('Release failed after a press');
        }
        if (args.type === 'mousePressed') {
          presses.push({ x: args.x, y: args.y });
          page.ready = false;
        }
        return {};
      },
    },
  };
  const context = vm.createContext({
    chrome,
    setTimeout: (callback) => callback(),
    console: {
      log: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  });
  context.importScripts = (file) =>
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, '../extension', file), 'utf8'),
      context,
    );
  vm.runInContext(source, context);
  const sender = {
    frameId: 0,
    documentId: 'original-document',
    url: tab.url,
    tab: { id: 1 },
  };
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(attached, false, 'debugger must be detached after the check');
  return {
    presses,
    markers,
    logs,
    stored,
    events,
    evaluations,
    context,
    sender,
    page,
  };
}

test('true retains saved coordinates', async () => {
  const { presses } = await runRule('true');
  assert.deepEqual(presses, [{ x: 313, y: 350 }]);
});

test('object expression overrides both saved coordinates', async () => {
  const { presses } = await runRule('({ x: 55, y: 110 })');
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

test('DOM-based return body uses returned coordinates for input and markers', async () => {
  const { presses, markers, logs } = await runRule(
    `const rect = rectBox.getBoundingClientRect();
     return { x: rect.left + 15, y: rect.top + rect.height / 2 };`,
    { visualize: true },
  );
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
  assert.ok(markers.length > 0);
  assert.ok(markers.every((marker) => marker.includes('left:55px;top:110px')));
  const center = logs.find(([message]) =>
    message.includes('resolved sweep center'),
  )[1];
  assert.equal(center.x, 55);
  assert.equal(center.y, 110);
});

test('uppercase coordinates and fractional coordinates work', async () => {
  const { presses } = await runRule('return { X: 55.2, Y: 110.7 };');
  assert.deepEqual(presses, [{ x: 55, y: 111 }]);
});

test('a grid is centered on returned coordinates', async () => {
  const { presses } = await runRule('({ x: 55, y: 110 })', { gridSize: 3 });
  assert.equal(presses.length, 9);
  assert.deepEqual(presses[0], { x: 55, y: 110 });
  assert.equal(Math.min(...presses.map((point) => point.x)), 45);
  assert.equal(Math.max(...presses.map((point) => point.x)), 65);
  assert.equal(Math.min(...presses.map((point) => point.y)), 100);
  assert.equal(Math.max(...presses.map((point) => point.y)), 120);
});

test('false after the first click stops a computed-coordinate sweep', async () => {
  const { presses } = await runRule('ready ? { x: 55, y: 110 } : false', {
    gridSize: 3,
  });
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

for (const expression of [
  'false',
  '({ x: -1, y: 110 })',
  '({ x: "55", y: 110 })',
  '({ x: 55 })',
  '({ x: NaN, y: 110 })',
  'Promise.resolve({ x: 55, y: 110 })',
  'throw new Error("failed")',
]) {
  test(`invalid result does not fall back to saved coordinates: ${expression}`, async () => {
    const { presses } = await runRule(expression);
    assert.deepEqual(presses, []);
  });
}

test('execution status records JS source and returned coordinates', async () => {
  const { stored } = await runRule('return { x: 313, y: 350 };');
  assert.equal(stored.lastSweep.type, 'expression');
  assert.equal(stored.lastSweep.ruleId, 'expression');
  assert.equal(stored.lastSweep.center.x, 313);
  assert.equal(stored.lastSweep.center.y, 350);
});

test('computed coordinates work with empty fallback fields', async () => {
  const { presses } = await runRule('return { x: 55, y: 110 };', {
    x: null,
    y: null,
  });
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

test('true with empty fallback fields does not click at zero', async () => {
  const { presses } = await runRule('true', { x: null, y: null });
  assert.deepEqual(presses, []);
});

test('single click executes with invalid unused spacing and delay', async () => {
  const { presses } = await runRule('return { x: 55, y: 110 };', {
    step: NaN,
    intervalMs: 1.5,
  });
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

for (const intervalMs of [0, 30]) {
  test(`grid executes with ${intervalMs} ms delay`, async () => {
    const { presses } = await runRule('return { x: 55, y: 110 };', {
      gridSize: 3,
      intervalMs,
    });
    assert.equal(presses.length, 9);
  });
}

test('false conditions never attach the debugger, including repeated polls', async () => {
  const { context, sender, events, evaluations } = await runRule('false');
  assert.ok(evaluations > 0);
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(events.includes('attach'), false);
  assert.equal(
    events.filter((event) => event === 'USER_SCRIPT').length,
    1,
    'compiler output is cached',
  );
});

for (const expression of [
  'throw new Error("failed")',
  'return {',
  '({ x: -1, y: 20 })',
  'Promise.resolve(true)',
]) {
  test(`failed condition does not attach: ${expression}`, async () => {
    const { events } = await runRule(expression);
    assert.equal(events.includes('attach'), false);
  });
}

for (const options of [
  { userScripts: false },
  { revoked: true },
  { documentChanges: true },
  { active: false },
]) {
  test(`unavailable script or document never falls back to debugger: ${JSON.stringify(options)}`, async () => {
    const { presses, events } = await runRule('true', options);
    assert.equal(events.includes('attach'), false);
    assert.deepEqual(presses, []);
  });
}

test('matching page-global expression attaches only after a successful main-world check', async () => {
  const { events, presses } = await runRule(
    'ready ? { x: 55, y: 110 } : false',
  );
  assert.ok(events.indexOf('MAIN') < events.indexOf('attach'));
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

test('condition rechecked after attachment can stop before first click', async () => {
  const { events, presses } = await runRule('ready', { stopOnAttach: true });
  assert.equal(events.includes('attach'), true);
  assert.deepEqual(presses, []);
});

test('a false condition can later become true, and fires only once', async () => {
  const { context, sender, page, presses } = await runRule('!ready');
  page.ready = false;
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(presses.length, 1);
});

test('page globals are not shadowed by evaluator variables', async () => {
  const { presses } = await runRule("value === 'ready' ? { x, y } : false");
  assert.deepEqual(presses, [{ x: 55, y: 110 }]);
});

test('transient first-navigation attachment failure retries without refresh', async () => {
  const { context, sender, presses } = await runRule('true', {
    attachFailures: 1,
  });
  assert.equal(presses.length, 0);
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(presses.length, 1);
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(presses.length, 1);
});

test('failure after a mouse press does not cause a duplicate automatic click', async () => {
  const { context, sender, page, presses } = await runRule('true', {
    releaseFailures: 1,
  });
  assert.equal(presses.length, 1);
  page.ready = true;
  await context.checkAutomaticRules({ type: 'CHECK_EXPRESSION_RULES' }, sender);
  assert.equal(presses.length, 1);
});

test('fresh install seeds serializable bundled rules and later updates do not reseed', async () => {
  const { context } = await runRule('false');
  const writes = [];
  context.defaultRules = () => [
    {
      id: 'example-js-target',
      builtinId: 'example-js-target',
      ruleType: 'bundled',
      enabled: true,
    },
  ];
  context.chrome.storage.local.get = async () => ({});
  context.chrome.storage.local.set = async (value) => writes.push(value);
  await context.installDefaultRules({ reason: 'update' });
  assert.equal(writes.length, 0);
  await context.installDefaultRules({ reason: 'install' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].autoRules[0].ruleType, 'bundled');
  assert.equal(writes[0].autoRules[0].builtinId, 'example-js-target');
  assert.equal(writes[0].autoRules[0].condition, undefined);
  assert.equal(writes[0].autoRules.length, 1);
  assert.equal(writes[0].autoRules[0].enabled, true);
  assert.doesNotThrow(() => JSON.stringify(writes[0]));
});

for (const existing of [
  { autoRules: [] },
  { autoRules: [{ id: 'mine' }] },
  { autoRule: { id: 'legacy' } },
  { rulesDraft: { rules: [] } },
]) {
  test(`install preserves existing user state ${JSON.stringify(existing)}`, async () => {
    const { context } = await runRule('false');
    let writes = 0;
    context.chrome.storage.local.get = async () => existing;
    context.chrome.storage.local.set = async () => {
      writes++;
    };
    await context.installDefaultRules({ reason: 'install' });
    assert.equal(writes, 0);
  });
}

test('bundled condition executes without User Scripts and normalizes DOM coordinates', async () => {
  const { context } = await runRule('false', { userScripts: false });
  context.defaultRules = function (id) {
    if (id !== 'example-js-target') return false;
    const rect = document.querySelector('button').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const page = vm.createContext({
    document: {
      querySelector: () => ({
        getBoundingClientRect: () => ({
          left: 40,
          top: 80,
          width: 60,
          height: 60,
        }),
      }),
    },
  });
  context.chrome.scripting = {
    executeScript: async ({ func, args, target, world, injectImmediately }) => {
      assert.equal(world, 'MAIN');
      assert.equal(injectImmediately, true);
      assert.equal(target.documentIds[0], 'original-document');
      return [
        {
          documentId: 'original-document',
          result: vm.runInContext(
            `(${func.toString()})(${JSON.stringify(args[0])})`,
            page,
          ),
        },
      ];
    },
  };
  const result = await context.evaluateBundledRule(
    1,
    'original-document',
    'example-js-target',
  );
  assert.equal(result.x, 70);
  assert.equal(result.y, 110);
  assert.equal(
    await context.evaluateBundledRule(1, 'original-document', 'unknown-id'),
    false,
  );
});
