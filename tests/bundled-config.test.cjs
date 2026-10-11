const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

test('plain RULES.push config preserves helper scope and executes packaged conditions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clickyphus-config-'));
  try {
    const output = path.join(temp, 'bundled-rules.js');
    const build = spawnSync(
      'python3',
      [
        path.resolve(__dirname, '../scripts/bundle_rules.py'),
        path.join(__dirname, 'fixtures/default-rules.js'),
        output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(build.status, 0, build.stderr);
    const context = vm.createContext(
      { document: { querySelector: () => null } },
      { codeGeneration: { strings: false, wasm: false } },
    );
    vm.runInContext(fs.readFileSync(output, 'utf8'), context);
    const rules = context.defaultRules();
    assert.equal(rules.length, 1);
    assert.equal(rules[0].enabled, true);
    assert.equal(rules[0].builtinId, 'example-js-target');
    assert.equal(rules[0].condition, undefined);
    assert.equal(context.defaultRules('example-js-target'), false);
    context.document.querySelector = () => ({
      getBoundingClientRect: () => ({
        left: 40,
        top: 80,
        width: 60,
        height: 60,
      }),
    });
    const result = context.defaultRules('example-js-target');
    assert.equal(result.x, 70);
    assert.equal(result.y, 110);
    assert.equal(context.defaultRules('unknown'), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
