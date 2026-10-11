const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function executor({ failMove = false } = {}) {
  const events = [],
    delays = [],
    presses = [];
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (callback, ms) => {
      delays.push(ms);
      events.push(`wait:${ms}`);
      callback();
    },
    chrome: {
      debugger: {
        attach: async ({ tabId }) => {
          events.push(`attach:${tabId}`);
        },
        detach: async ({ tabId }) => {
          events.push(`detach:${tabId}`);
        },
        sendCommand: async (target, method, args) => {
          if (method === 'Runtime.evaluate') {
            events.push('marker');
            return;
          }
          if (args.type === 'mouseMoved' && failMove) {
            failMove = false;
            throw new Error('Move failed');
          }
          events.push(args.type);
          if (args.type === 'mousePressed')
            presses.push({ x: args.x, y: args.y });
        },
      },
    },
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, '../extension/grid-executor.js'),
      'utf8',
    ),
    context,
  );
  const grid = context.createGridExecutor({ isFocusedTab: async () => true });
  return { grid, events, delays, presses };
}
const single = { tabId: 1, x: 50, y: 50, gridSize: 1, visualize: false };

test('manual delay, marker pause, and press hold retain their order without storage access', async () => {
  const { grid, events, delays } = executor();
  let starts = 0;
  await grid.run({
    ...single,
    visualize: true,
    startDelayMs: 600,
    onStart: ({ center }) => {
      starts++;
      assert.equal(center.x, 50);
      events.push('history');
    },
  });
  assert.equal(starts, 1);
  assert.deepEqual(delays, [600, 120, 80]);
  assert.deepEqual(events, [
    'wait:600',
    'attach:1',
    'marker',
    'wait:120',
    'history',
    'mouseMoved',
    'mousePressed',
    'wait:80',
    'mouseReleased',
    'marker',
    'detach:1',
  ]);
});

test('10x10 grid emits 100 points nearest-first, with separate press hold and click pause', async () => {
  const { grid, presses, delays } = executor();
  const result = await grid.run({
    ...single,
    gridSize: 10,
    step: 10,
    intervalMs: 30,
  });
  assert.equal(result.completed, 100);
  assert.equal(new Set(presses.map((p) => `${p.x},${p.y}`)).size, 100);
  assert.deepEqual(presses.slice(0, 4), [
    { x: 45, y: 45 },
    { x: 55, y: 45 },
    { x: 45, y: 55 },
    { x: 55, y: 55 },
  ]);
  const distances = presses.map((p) => (p.x - 50) ** 2 + (p.y - 50) ** 2);
  assert.ok(
    distances.every((distance, i) => !i || distance >= distances[i - 1]),
  );
  assert.equal(delays.filter((ms) => ms === 80).length, 100);
  assert.equal(delays.filter((ms) => ms === 30).length, 99);
});

test('queued sweeps never overlap debugger sessions on the same tab', async () => {
  const { grid, events, presses } = executor();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = grid.run({ ...single, onStart: () => gate });
  const second = grid.run({ ...single, x: 60 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(grid.isBusy(1), true);
  assert.deepEqual(events, ['attach:1']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    events.filter((event) => event.includes(':1')),
    ['attach:1', 'detach:1', 'attach:1', 'detach:1'],
  );
  assert.deepEqual(presses, [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
  ]);
  assert.equal(grid.isBusy(1), false);
});

test('a failed sweep detaches and allows the next queued sweep to run', async () => {
  const { grid, events, presses } = executor({ failMove: true });
  const first = assert.rejects(
    grid.run(single),
    (error) => error.completed === 0,
  );
  const second = grid.run({ ...single, x: 60 });
  await Promise.all([first, second]);
  assert.deepEqual(presses, [{ x: 60, y: 50 }]);
  assert.deepEqual(
    events.filter((event) => event.includes(':1')),
    ['attach:1', 'detach:1', 'attach:1', 'detach:1'],
  );
  assert.equal(grid.isBusy(1), false);
});

test('history callback failure does not prevent clicking or cleanup', async () => {
  const { grid, presses, events } = executor();
  await grid.run({
    ...single,
    onStart: async () => {
      throw new Error('Storage unavailable');
    },
  });
  assert.equal(presses.length, 1);
  assert.equal(events.at(-1), 'detach:1');
});
