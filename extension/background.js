/* global defaultRules, createGridExecutor, createRuleEvaluator */
importScripts('bundled-rules.js', 'rule-evaluation.js', 'grid-executor.js');
const evaluateAutomaticRule = createRuleEvaluator({ defaultRules });

// Defaults are copied into local storage once; later edits belong to the user.
async function installDefaultRules(details) {
  if (details.reason !== 'install') return;
  const defaults = defaultRules();
  const existing = await chrome.storage.local.get([
    'autoRules',
    'autoRule',
    'rulesDraft',
  ]);
  // An empty list is intentional too. Never restore rules the user removed.
  if (
    existing.autoRules !== undefined ||
    existing.autoRule !== undefined ||
    existing.rulesDraft != null
  )
    return;
  await chrome.storage.local.set({ autoRules: defaults });
}

chrome.runtime.onInstalled.addListener((details) => {
  installDefaultRules(details).catch((error) =>
    console.warn('[clickyphus] default rule installation failed', error),
  );
});

const pickingTabs = new Set();
const gridExecutor = createGridExecutor({ isFocusedTab });

// History belongs to the worker; the executor only reports where input starts.
async function recordSweep(source, sweep) {
  await chrome.storage.local.set({
    lastSweep: {
      ...source,
      ...sweep,
      version: chrome.runtime.getManifest().version,
      startedAt: Date.now(),
    },
  });
}

async function isFocusedTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const window = await chrome.windows.get(tab.windowId);
    return tab.active && window.focused && !pickingTabs.has(tabId);
  } catch {
    return false;
  }
}

// Content scripts recheck live text in every accessible frame on focus.
async function recheckFocusedTab(tabId) {
  if (!(await isFocusedTab(tabId))) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RECHECK_AUTO_RULES' });
  } catch {
    /* Restricted pages or content scripts that have not loaded yet. */
  }
}
chrome.tabs.onActivated.addListener(({ tabId }) => {
  recheckFocusedTab(tabId);
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab?.id != null) await recheckFocusedTab(tab.id);
  } catch {
    /* Window may have closed. */
  }
});

function matchesRuleUrl(url, urlMatch) {
  const match = urlMatch?.trim().toLowerCase() || '';
  return !match || match === '*' || url.toLowerCase().includes(match);
}

function getGridSize(message) {
  return message.gridSize ?? (message.radius ?? 1) * 2 + 1;
}

async function getUserScriptsStatus() {
  try {
    if (!chrome.userScripts?.execute) return { available: false };
    await chrome.userScripts.getScripts();
    return { available: true };
  } catch {
    return { available: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'GET_USER_SCRIPTS_STATUS') return false;
  getUserScriptsStatus().then(respond);
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CLICK_AT' && message?.type !== 'CLICK_GRID')
    return false;
  sendResponse({ ok: true, queued: true });
  const gridSize = message.type === 'CLICK_AT' ? 1 : getGridSize(message);
  // Give the popup time to close, then start the sweep.
  gridExecutor
    .run({
      tabId: message.tabId,
      x: message.x,
      y: message.y,
      gridSize,
      step: message.step ?? 10,
      intervalMs: message.intervalMs ?? 180,
      startDelayMs: 600,
      visualize: message.visualize !== false,
      onStart: (sweep) => recordSweep({ type: 'manual' }, sweep),
    })
    .then((result) => console.log('[clickyphus] popup sweep completed', result))
    .catch((error) => console.error('[clickyphus] popup sweep failed', error));
  return false;
});

// Automatic rules: each rule runs at most once per top-level page load.
const autoFired = new Map(); // tabId -> Set(ruleId)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' || changeInfo.url)
    autoFired.delete(tabId);
  if (changeInfo.url || changeInfo.status === 'complete')
    recheckFocusedTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => autoFired.delete(tabId));

// One lifecycle for every automatic rule: reserve, evaluate, click, release
// unsuccessful attempts. The grid executor owns input dispatch and debugger cleanup.
async function runAutomaticRule(rule, sender, tab) {
  const tabId = sender.tab.id;
  let fired = autoFired.get(tabId);
  if (!fired) {
    fired = new Set();
    autoFired.set(tabId, fired);
  }
  if (fired.has(rule.id)) return;
  fired.add(rule.id);
  const expectedUrl = tab.url;
  const isCurrentPage = async () =>
    autoFired.get(tabId) === fired &&
    (await chrome.tabs.get(tabId)).url === expectedUrl;
  const shouldContinue = async () => {
    try {
      if (!(await isCurrentPage())) return false;
      const value = await evaluateAutomaticRule(rule, tabId, sender);
      return value && (await isCurrentPage()) ? value : false;
    } catch {
      return false;
    }
  };
  let completed = 0;
  try {
    const result = await gridExecutor.run({
      tabId,
      x: rule.x,
      y: rule.y,
      gridSize: getGridSize(rule),
      step: rule.step,
      intervalMs: rule.intervalMs,
      visualize: rule.visualize,
      shouldContinue,
      onStart: (sweep) =>
        recordSweep(
          {
            type: ['expression', 'bundled'].includes(rule.ruleType)
              ? rule.ruleType
              : 'text',
            ruleId: rule.id,
          },
          sweep,
        ),
    });
    completed = result.completed;
    return result;
  } catch (error) {
    // Input may have reached the page even if a later command failed.
    completed = error.completed || 0;
    console.warn('[clickyphus] automatic sweep failed', rule.id, error);
  } finally {
    if (completed === 0 && autoFired.get(tabId) === fired)
      fired.delete(rule.id);
  }
}

async function checkAutomaticRules(message, sender) {
  const expressionScan = message.type === 'CHECK_EXPRESSION_RULES';
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return;
  // JS belongs to the top-level document. Text can match inside any frame.
  if (expressionScan && (sender.frameId !== 0 || !sender.documentId)) return;
  if (expressionScan) await gridExecutor.whenIdle(tabId);
  if (!(await isFocusedTab(tabId))) return;
  const { autoRules = [] } = await chrome.storage.local.get('autoRules');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || (expressionScan && sender.url !== tab.url)) return;
  const pending = [];
  for (const rule of autoRules) {
    if (!rule.enabled || !matchesRuleUrl(tab.url, rule.urlMatch)) continue;
    const scripted = ['expression', 'bundled'].includes(rule.ruleType);
    if (expressionScan) {
      if (
        !scripted ||
        (rule.ruleType === 'expression' && !rule.expression?.trim())
      )
        continue;
    } else if (
      scripted ||
      !rule.textMatch?.trim() ||
      rule.textMatch.toLowerCase() !== message.textMatch
    ) {
      continue;
    }
    const run = runAutomaticRule(rule, sender, tab);
    // Preserve admission behavior: text notifications reserve queued matches;
    // JS scans evaluate successive rules after the preceding sweep finishes.
    if (expressionScan) await run;
    else pending.push(run);
  }
  await Promise.all(pending);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!['CHECK_EXPRESSION_RULES', 'AUTO_TEXT_FOUND'].includes(message?.type))
    return false;
  checkAutomaticRules(message, sender).catch((error) =>
    console.warn('[clickyphus] automatic rule check failed', error),
  );
  return false;
});

// Coordinate picking is handled outside the popup so it survives popup closure.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'PICK_POINT') {
    (async () => {
      // The toolbar popup may own focus. Resolve its underlying normal window
      // rather than applying the stricter click-execution focus guard here.
      const browserWindow = await chrome.windows.getLastFocused({
        windowTypes: ['normal'],
      });
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.active || tab.windowId !== browserWindow.id) {
        throw new Error(
          'The target tab changed. Reopen the extension on the page you want to pick.',
        );
      }
      pickingTabs.add(message.tabId);
      try {
        const result = await chrome.tabs.sendMessage(
          message.tabId,
          { type: 'START_POINT_PICKER' },
          { frameId: 0 },
        );
        if (!result?.ok) throw new Error('Picker unavailable.');
        respond({ ok: true });
      } catch {
        pickingTabs.delete(message.tabId);
        respond({
          ok: false,
          error:
            'Refresh the page and try again. Chrome internal pages cannot be picked.',
        });
      }
    })().catch((error) => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === 'POINT_PICKER_DONE') {
    (async () => {
      const tabId = sender.tab?.id;
      if (sender.frameId !== 0 || !pickingTabs.has(tabId)) return;
      pickingTabs.delete(tabId);
      const point = message.point;
      if (
        !point ||
        !Number.isInteger(point.x) ||
        !Number.isInteger(point.y) ||
        point.x < 0 ||
        point.y < 0
      )
        return;
      const { pickerTarget, manualDraft, rulesDraft } =
        await chrome.storage.local.get([
          'pickerTarget',
          'manualDraft',
          'rulesDraft',
        ]);
      if (pickerTarget?.tabId !== tabId) return;
      if (pickerTarget.type === 'rule') {
        if (
          rulesDraft?.tabId !== tabId ||
          rulesDraft.ruleId !== pickerTarget.ruleId
        )
          return;
        const rules = rulesDraft.rules.map((rule) =>
          rule.id === pickerTarget.ruleId
            ? { ...rule, ...point, _open: true }
            : rule,
        );
        if (!rules.some((rule) => rule.id === pickerTarget.ruleId)) return;
        await chrome.storage.local.set({
          rulesDraft: { ...rulesDraft, rules, picked: true },
          pickerTarget: null,
        });
      } else {
        if (manualDraft?.tabId !== tabId) return;
        await chrome.storage.local.set({
          manualDraft: { ...manualDraft, ...point, picked: true },
          pickerTarget: null,
        });
      }
      if (await isFocusedTab(tabId)) {
        try {
          await chrome.action.openPopup();
        } catch {
          /* Coordinates remain available when the user reopens the popup. */
        }
      }
    })().catch((error) => console.warn('[clickyphus] picker failed', error));
  }
  return false;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') pickingTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => pickingTabs.delete(tabId));
