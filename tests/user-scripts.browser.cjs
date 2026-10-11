const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const path = require('node:path'),
  os = require('node:os');
(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(
        `window.ready=false;window.checks=0;window.clicks=[];document.addEventListener('click',e=>{clicks.push({x:e.clientX,y:e.clientY,trusted:e.isTrusted});document.querySelector('.ready')?.remove();});`,
      );
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Security-Policy',
      "script-src 'self'; object-src 'none'; require-trusted-types-for 'script'",
    );
    res.end(
      '<html><body>Ready to continue<script src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'clickyphus-userscripts-'),
  );
  const extension = path.join(profile, 'test-extension');
  fs.cpSync(path.resolve(__dirname, '../extension'), extension, {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(__dirname, 'fixtures/default-rules.js'),
    path.join(extension, 'default-rules.js'),
  );
  const bundle = spawnSync(
    'python3',
    [
      path.resolve(__dirname, '../scripts/bundle_rules.py'),
      path.join(extension, 'default-rules.js'),
      path.join(extension, 'bundled-rules.js'),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(bundle.status, 0, bundle.stderr);
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true,
      viewport: { width: 400, height: 590 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    let worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const base = `http://127.0.0.1:${server.address().port}/`;
    let initialRules;
    for (let attempt = 0; attempt < 30; attempt++) {
      initialRules = await worker.evaluate(
        async () => (await chrome.storage.local.get('autoRules')).autoRules,
      );
      if (initialRules) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(initialRules.length, 1);
    assert.equal(initialRules[0].ruleType, 'bundled');
    assert.equal(initialRules[0].enabled, true);
    const defaultsPopup = await context.newPage();
    await defaultsPopup.goto(`chrome-extension://${id}/popup/popup.html`);
    await defaultsPopup.waitForFunction(
      () => document.querySelectorAll('#rules .rule').length === 1,
    );
    assert.equal(
      await defaultsPopup.locator('#script-setup').isVisible(),
      false,
    );
    await defaultsPopup
      .locator('#rules .rule')
      .first()
      .locator('summary')
      .click();
    await defaultsPopup
      .locator('#rules .rule')
      .first()
      .locator('[name="visualize"]')
      .uncheck();
    await defaultsPopup.locator('#save-rules').click();
    await defaultsPopup.waitForFunction(
      () =>
        document.querySelector('#save-state').textContent === '1 rule saved',
    );
    const savedDefault = await worker.evaluate(
      async () => (await chrome.storage.local.get('autoRules')).autoRules[0],
    );
    assert.equal(savedDefault.builtinId, initialRules[0].builtinId);
    assert.equal(savedDefault.visualize, false);
    await defaultsPopup.close();
    console.log(
      'PASS: first-install defaults appear in the editor, save their settings, and require no User Scripts setup.',
    );
    const instrument = async () =>
      worker.evaluate(() => {
        globalThis.debuggerEvents = [];
        globalThis.failNextAttach = false;
        globalThis.attachFailures = 0;
        const attach = chrome.debugger.attach.bind(chrome.debugger),
          detach = chrome.debugger.detach.bind(chrome.debugger);
        chrome.debugger.attach = (...args) => {
          if (failNextAttach) {
            failNextAttach = false;
            attachFailures++;
            return Promise.reject(
              new Error('Simulated transient navigation attachment failure'),
            );
          }
          debuggerEvents.push('attach');
          return attach(...args);
        };
        chrome.debugger.detach = (...args) => {
          debuggerEvents.push('detach');
          return detach(...args);
        };
      });
    await instrument();
    const rule = {
      id: 'js',
      enabled: true,
      ruleType: 'expression',
      expression: 'return true;',
      urlMatch: '',
      x: 50,
      y: 50,
      gridSize: 3,
      step: 10,
      intervalMs: 30,
      visualize: false,
    };
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      rule,
    );
    const page = await context.newPage();
    await page.goto(base);
    await page.bringToFront();
    await page.waitForTimeout(3000);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), []);
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      { ...initialRules[0], enabled: true, urlMatch: '', visualize: true },
    );
    await page.goto(base + 'bundled');
    await page.bringToFront();
    await page.evaluate(() => {
      const button = document.createElement('button');
      button.className = 'ready';
      button.dataset.clickyphusTarget = '';
      button.style.cssText =
        'position:fixed;left:100px;top:100px;width:100px;height:60px';
      document.body.append(button);
    });
    await page.waitForFunction(() => window.clicks.length === 1);
    const marker = page.locator('#__clickyphus_visualizer__');
    await marker.waitFor();
    assert.equal(await marker.locator('svg').count(), 1);
    assert.equal(
      await marker.locator('svg g').getAttribute('transform'),
      'translate(108 0) scale(-1 1)',
    );
    assert.equal(
      await marker.evaluate((el) => getComputedStyle(el).pointerEvents),
      'none',
    );
    assert.equal(
      await marker
        .locator('svg')
        .evaluate((el) => el.parentElement.style.transform),
      'rotate(-30deg)',
    );
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.clicks), [
      { x: 150, y: 130, trusted: true },
    ]);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), [
      'attach',
      'detach',
    ]);
    assert.equal(
      await worker.evaluate(
        async () => (await getUserScriptsStatus()).available,
      ),
      false,
    );
    await worker.evaluate((rule) => {
      debuggerEvents = [];
      return chrome.storage.local.set({ autoRules: [rule] });
    }, rule);
    console.log(
      'PASS: built-in rule clicks under strict CSP with Allow User Scripts disabled.',
    );
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup/popup.html`);
    await popup.locator('#script-setup').waitFor({ state: 'visible' });
    console.log(
      'PASS: User Scripts disabled → setup guidance and no debugger attachment.',
    );
    const settingsPromise = context.waitForEvent('page');
    await popup.locator('#open-script-settings').click();
    const settings = await settingsPromise;
    await settings.waitForLoadState();

    const toggle = settings
      .locator('extensions-toggle-row')
      .filter({ hasText: /Allow User Scripts/i })
      .locator('cr-toggle');
    await toggle.click();

    assert.equal(
      await worker.evaluate(
        async () => (await getUserScriptsStatus()).available,
      ),
      true,
    );
    const expression = `window.checks = (window.checks || 0) + 1;
 const el = document.querySelector('.ready');
 if (!el || !window.ready) return false;
 const rect = el.getBoundingClientRect();
 return { x: rect.left + 15, y: rect.top + rect.height / 2 };`;
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      { ...rule, expression },
    );
    await page.goto(base + 'first-navigation');
    await page.bringToFront();
    await page.waitForFunction(() => window.checks >= 2);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), []);
    console.log(
      'PASS: repeated DOM/page-global checks under strict CSP never attach while false.',
    );
    await worker.evaluate(() => {
      failNextAttach = true;
    });
    await page.evaluate(() => {
      window.ready = true;
      const el = document.createElement('button');
      el.className = 'ready';
      el.textContent = 'Ready';
      el.style.cssText =
        'position:fixed;left:100px;top:100px;width:100px;height:60px';
      document.body.append(el);
    });
    await page.waitForFunction(() => window.clicks.length > 0);
    assert.equal(await worker.evaluate(() => attachFailures), 1);
    await page.waitForFunction(() => !document.querySelector('.ready'));
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => window.clicks), [
      { x: 115, y: 130, trusted: true },
    ]);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), [
      'attach',
      'detach',
    ]);
    console.log(
      'PASS: first-navigation JS retries a transient attachment failure without refresh, clicks at returned coordinates, then stops and detaches.',
    );
    const enabledPopup = await context.newPage();
    await enabledPopup.goto(`chrome-extension://${id}/popup/popup.html`);
    await enabledPopup.waitForFunction(() => userScriptsAvailable === true);
    assert.equal(
      await enabledPopup.locator('#script-setup').isVisible(),
      false,
    );
    await enabledPopup.close();
    // A new document must be polled independently; invalid source must stay quiet.
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      { ...rule, expression: 'return {' },
    );
    await page.goto(base);
    await page.bringToFront();
    await page.waitForTimeout(3000);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), [
      'attach',
      'detach',
    ]);
    console.log('PASS: syntax errors do not attach or click.');
    // Revoke permission and verify text rules can still run.
    await settings.bringToFront();
    await settings.reload();
    await settings
      .locator('extensions-toggle-row')
      .filter({ hasText: /Allow User Scripts/i })
      .locator('cr-toggle')
      .click();
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      { ...rule, expression: 'true' },
    );
    await page.goto(base);
    await page.bringToFront();
    await page.waitForTimeout(3000);
    assert.deepEqual(await worker.evaluate(() => debuggerEvents), [
      'attach',
      'detach',
    ]);
    await worker.evaluate(
      (rule) => chrome.storage.local.set({ autoRules: [rule] }),
      {
        ...rule,
        id: 'text',
        ruleType: 'text',
        textMatch: 'Ready to continue',
        gridSize: 1,
      },
    );
    await page.goto(base);
    await page.bringToFront();
    await page.waitForFunction(() => window.clicks.length === 1);
    assert.deepEqual(await page.evaluate(() => window.clicks), [
      { x: 50, y: 50, trusted: true },
    ]);
    console.log(
      'PASS: revoking User Scripts pauses JS without fallback; text rules still click.',
    );
    console.log('All live User Scripts checks passed.');
  } finally {
    await context?.close();
    server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
