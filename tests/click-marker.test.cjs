const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function markerPage(reducedMotion = false) {
  const host = {
    children: [],
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
  };
  function element() {
    return {
      style: {},
      append() {},
      setAttribute() {},
      animations: [],
      animate(frames) {
        this.animations.push(frames);
      },
    };
  }
  const context = vm.createContext({
    document: {
      getElementById: () => host,
      createElement: element,
      createElementNS: element,
    },
    window: { innerWidth: 900, matchMedia: () => ({ matches: reducedMotion }) },
    clearTimeout() {},
    setTimeout() {},
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, '../extension/grid-executor.js'),
      'utf8',
    ),
    context,
  );
  return { host, draw: context.drawClickMarker };
}

function pose(gun) {
  const css = gun.style.cssText;
  return {
    x: Number(css.match(/left:([\d.-]+)px/)[1]),
    y: Number(css.match(/top:([\d.-]+)px/)[1]),
    angle: Number(css.match(/rotate\(([\d.-]+)deg\)/)[1]),
  };
}

test('progressive shots keep aim and fire aligned, reverse at ±30°, and hit the exact target', () => {
  const { host, draw } = markerPage();
  const expected = [-30, -20, -10, 0, 10, 20, 30, 20, 10, 0, -10, -20, -30];
  for (const x of [350, 865]) {
    for (let i = 0; i < expected.length; i++) {
      draw(x, 280, i + 1, 100, false);
      const aim = pose(host.children[4]);
      draw(x, 280, i + 1, 100, true);
      const fired = pose(host.children[4]);
      assert.deepEqual(fired, aim);
      assert.equal(fired.angle, expected[i]);
      assert.ok(fired.x > x);
      const bullet = host.children[5];
      const end = bullet.animations[0][1].transform;
      const distance = -Number(end.match(/translateX\(([\d.-]+)px\)/)[1]);
      const radians = (fired.angle * Math.PI) / 180;
      assert.ok(Math.abs(fired.x - distance * Math.cos(radians) - x) < 1e-8);
      assert.ok(Math.abs(fired.y - distance * Math.sin(radians) - 280) < 1e-8);
    }
  }
  draw(350, 280, 1, 9, false);
  assert.equal(pose(host.children[4]).angle, -30, 'new sweep resets its pose');
});

test('reduced motion preserves progressive poses without recoil or projectiles', () => {
  const { host, draw } = markerPage(true);
  draw(350, 280, 7, 9, true);
  assert.equal(pose(host.children[4]).angle, 30);
  assert.equal(host.children.length, 5);
  assert.equal(host.children[4].animations.length, 0);
});
