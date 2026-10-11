const queues = new Map();
const pickingTabs = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runSerially(tabId, task) {
  const prior = queues.get(tabId) || Promise.resolve();
  const current = prior.catch(() => {}).then(task);
  queues.set(tabId, current);
  current
    .finally(() => {
      if (queues.get(tabId) === current) queues.delete(tabId);
    })
    .catch(() => {});
  return current;
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

function pointsAround(x, y, gridSize, step) {
  // For even sizes, the requested point lies between the four central cells.
  // Round resulting coordinates to browser CSS pixels.
  const start = -(gridSize - 1) / 2;
  const points = [];
  for (let iy = 0; iy < gridSize; iy++) {
    for (let ix = 0; ix < gridSize; ix++) {
      const px = Math.round(x + (start + ix) * step);
      const py = Math.round(y + (start + iy) * step);
      if (px >= 0 && py >= 0) points.push({ x: px, y: py });
    }
  }
  // Click nearest the requested point first, and expand outward.
  points.sort(
    (a, b) =>
      (a.x - x) ** 2 + (a.y - y) ** 2 - ((b.x - x) ** 2 + (b.y - y) ** 2),
  );
  return points;
}

function matchesRuleUrl(url, urlMatch) {
  const match = urlMatch?.trim().toLowerCase() || '';
  return !match || match === '*' || url.toLowerCase().includes(match);
}

function getGridSize(message) {
  return message.gridSize ?? (message.radius ?? 1) * 2 + 1;
}

// User-entered code is compiled in an isolated user-script world, then injected
// directly in MAIN so DOM/page globals work even when the page forbids eval.
const compiledRules = new Map();
const compilerWorld = 'coordinate-click-compiler';

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

async function evaluateUserRule(tabId, documentId, expression) {
  if (!chrome.userScripts?.execute) return false;
  const target = { tabId, documentIds: [documentId] };
  let compiled = compiledRules.get(expression);
  if (!compiled) {
    await chrome.userScripts.configureWorld({
      worldId: compilerWorld,
      csp: "script-src 'self' 'unsafe-eval'; object-src 'none'",
      messaging: false,
    });
    const [compilation] = await chrome.userScripts.execute({
      target,
      world: 'USER_SCRIPT',
      worldId: compilerWorld,
      js: [
        {
          code: `(() => {
        const source = ${JSON.stringify(expression)};
        let evaluate;
        try {
          evaluate = new Function(${JSON.stringify('return (\n')} + source + ${JSON.stringify('\n);')});
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          evaluate = new Function(source);
        }
        return evaluate.toString();
      })()`,
        },
      ],
    });
    if (
      compilation?.error ||
      compilation?.documentId !== documentId ||
      typeof compilation.result !== 'string'
    )
      return false;
    compiled = compilation.result;
    if (compiledRules.size >= 100)
      compiledRules.delete(compiledRules.keys().next().value);
    compiledRules.set(expression, compiled);
  }
  const [evaluation] = await chrome.userScripts.execute({
    target,
    world: 'MAIN',
    js: [
      {
        code: `((evaluate) => {
      try {
        const value = evaluate.call(window);
        if (value === true) return true;
        if (!value || typeof value !== 'object' || typeof value.then === 'function') return false;
        const x = value.x ?? value.X;
        const y = value.y ?? value.Y;
        return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : false;
      } catch (error) {
        console.warn('[coordinate-click] JS rule failed:', error);
        return false;
      }
    })(${compiled})`,
      },
    ],
  });
  if (evaluation?.error || evaluation?.documentId !== documentId) return false;
  const value = evaluation.result;
  if (value === true) return true;
  return value &&
    typeof value === 'object' &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.y >= 0
    ? { x: value.x, y: value.y }
    : false;
}

// Overlay lives in the top-level document, above nested cross-origin frames.
// pointer-events:none prevents the marker itself from swallowing clicks.
async function showMarker(target, x, y, index, total, clicked = false) {
  const source = `(() => {
    const id = '__coordinate_click_visualizer__';
    let host = document.getElementById(id);
    if (!host) {
      host = document.createElement('div');
      host.id = id;
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden';
      (document.documentElement || document.body).appendChild(host);
    }
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);width:24px;height:24px;border:3px solid #ff214f;border-radius:50%;background:rgba(255,33,79,.22);box-shadow:0 0 0 2px white,0 0 12px #ff214f;box-sizing:border-box';
    const h = document.createElement('div');
    h.style.cssText = 'position:absolute;left:${x - 16}px;top:${y}px;width:32px;border-top:1px solid #ff214f';
    const v = document.createElement('div');
    v.style.cssText = 'position:absolute;left:${x}px;top:${y - 16}px;height:32px;border-left:1px solid #ff214f';
    const label = document.createElement('div');
    label.textContent = '${index}/${total} (${x},${y})';
    label.style.cssText = 'position:absolute;left:${x + 18}px;top:${y + 13}px;background:#151515;color:#fff;border:1px solid #ff214f;padding:3px 6px;border-radius:4px;white-space:nowrap;font:12px monospace';
    host.replaceChildren(dot,h,v,label);
    if (${clicked}) {
      label.textContent = 'Clicked · ' + label.textContent;
      dot.style.background = '#ff214f';
      dot.animate([
        { transform: 'translate(-50%,-50%) scale(.65)' },
        { transform: 'translate(-50%,-50%) scale(1.2)' },
        { transform: 'translate(-50%,-50%) scale(1)' }
      ], { duration: 220, easing: 'ease-out' });
      const ripple = document.createElement('div');
      ripple.style.cssText = dot.style.cssText;
      ripple.style.background = 'transparent';
      host.append(ripple);
      ripple.animate([
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-50%) scale(2.5)', opacity: 0 }
      ], { duration: 320, easing: 'ease-out', fill: 'forwards' });
    }
    clearTimeout(window.__coordinateClickMarkerTimer);
    window.__coordinateClickMarkerTimer = setTimeout(() => host.remove(), 1600);
  })()`;
  try {
    await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
      expression: source,
      returnByValue: true,
    });
  } catch (error) {
    console.warn('[coordinate-click] overlay unavailable:', error.message);
  }
}

async function clickGrid(
  tabId,
  x,
  y,
  gridSize = 3,
  step = 10,
  intervalMs = 180,
  startDelayMs = 0,
  visualize = true,
  shouldContinue = null,
  source = { type: 'manual' },
) {
  // Spacing and delay have no effect on a single click.
  if (gridSize === 1) {
    step = 10;
    intervalMs = 180;
  }
  if (
    !Number.isInteger(tabId) ||
    tabId < 0 ||
    (!shouldContinue &&
      (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0)) ||
    !Number.isInteger(gridSize) ||
    gridSize < 1 ||
    gridSize > 20 ||
    !Number.isInteger(step) ||
    step < 1 ||
    step > 100 ||
    !Number.isInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs > 5000
  ) {
    throw new Error(
      'Invalid tab, coordinates, grid size (1–20), step (1–100), or interval (0–5000ms)',
    );
  }

  return runSerially(tabId, async () => {
    if (startDelayMs) await sleep(startDelayMs);
    if (!(await isFocusedTab(tabId))) {
      return {
        ok: true,
        stopped: true,
        reason: 'tab_inactive',
        tabId,
        completed: 0,
      };
    }
    // Preflight uses content/user scripts, so a false condition never attaches
    // the debugger. Recheck after attachment as its banner can change layout.
    if (shouldContinue) {
      const condition = await shouldContinue();
      if (!condition)
        return {
          ok: true,
          stopped: true,
          reason: 'condition_false',
          tabId,
          completed: 0,
        };
      const center = condition === true ? { x, y } : condition;
      if (
        !Number.isFinite(center.x) ||
        !Number.isFinite(center.y) ||
        center.x < 0 ||
        center.y < 0
      ) {
        return {
          ok: true,
          stopped: true,
          reason: 'invalid_coordinates',
          tabId,
          completed: 0,
        };
      }
    }
    if (!(await isFocusedTab(tabId)))
      return {
        ok: true,
        stopped: true,
        reason: 'tab_inactive',
        tabId,
        completed: 0,
      };
    const target = { tabId };
    await chrome.debugger.attach(target, '1.3');
    let completed = 0;
    let dispatched = 0;
    try {
      // Resolve an expression-provided center once; keep the grid fixed during
      // this sweep while continuing to recheck the condition before clicks.
      if (shouldContinue) {
        const condition = await shouldContinue();
        if (!condition) {
          return {
            ok: true,
            stopped: true,
            reason: 'condition_false',
            tabId,
            completed: 0,
          };
        }
        if (typeof condition === 'object') {
          x = condition.x;
          y = condition.y;
        }
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
        console.warn(
          '[coordinate-click] rule returned true but saved X/Y are invalid; return { x, y } or supply fallback coordinates',
        );
        return {
          ok: true,
          stopped: true,
          reason: 'invalid_coordinates',
          tabId,
          completed: 0,
        };
      }
      const points = pointsAround(x, y, gridSize, step);
      console.log('[coordinate-click] resolved sweep center', {
        tabId,
        x,
        y,
        gridSize,
        step,
        count: points.length,
      });
      for (const pt of points) {
        if (!(await isFocusedTab(tabId))) {
          return {
            ok: true,
            stopped: true,
            reason: 'tab_inactive',
            tabId,
            completed,
            total: points.length,
          };
        }
        // Automatic jobs check their condition before every individual click.
        // Manual jobs have no guard and behave exactly as before.
        if (shouldContinue && !(await shouldContinue())) {
          console.log(
            '[coordinate-click] AUTO STOP: matching text disappeared or frame unavailable',
            { tabId, completed, total: points.length },
          );
          return {
            ok: true,
            stopped: true,
            reason: 'text_missing',
            tabId,
            completed,
            total: points.length,
          };
        }
        if (visualize) {
          await showMarker(target, pt.x, pt.y, completed + 1, points.length);
          await sleep(120); // Let the crosshair become visible before clicking
        }
        // The page can change while the marker is shown; check again.
        if (shouldContinue && !(await shouldContinue())) {
          console.log('[coordinate-click] AUTO STOP before mouse press', {
            tabId,
            completed,
          });
          return {
            ok: true,
            stopped: true,
            reason: 'text_missing',
            tabId,
            completed,
            total: points.length,
          };
        }
        if (!(await isFocusedTab(tabId))) {
          return {
            ok: true,
            stopped: true,
            reason: 'tab_inactive',
            tabId,
            completed,
            total: points.length,
          };
        }
        if (completed === 0) {
          await chrome.storage.local
            .set({
              lastSweep: {
                ...source,
                tabId,
                center: { x, y },
                firstPoint: pt,
                version: chrome.runtime.getManifest().version,
                startedAt: Date.now(),
              },
            })
            .catch((error) =>
              console.warn('[coordinate-click] could not record sweep', error),
            );
        }
        const move = { type: 'mouseMoved', x: pt.x, y: pt.y };
        const press = {
          type: 'mousePressed',
          x: pt.x,
          y: pt.y,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        };
        const release = {
          type: 'mouseReleased',
          x: pt.x,
          y: pt.y,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        };
        await chrome.debugger.sendCommand(
          target,
          'Input.dispatchMouseEvent',
          move,
        );
        await chrome.debugger.sendCommand(
          target,
          'Input.dispatchMouseEvent',
          press,
        );
        dispatched++;
        await sleep(80);
        await chrome.debugger.sendCommand(
          target,
          'Input.dispatchMouseEvent',
          release,
        );
        completed++;
        if (visualize) {
          await showMarker(target, pt.x, pt.y, completed, points.length, true);
        }
        console.log(`[coordinate-click] ${completed}/${points.length}`, pt);
        if (completed < points.length) await sleep(intervalMs);
      }
      return { ok: true, tabId, completed, points };
    } catch (error) {
      console.error('[coordinate-click] sweep interrupted', {
        completed,
        error,
      });
      throw Object.assign(new Error(error.message, { cause: error }), {
        completed: dispatched,
      });
    } finally {
      try {
        await chrome.debugger.detach(target);
      } catch (error) {
        console.warn('[coordinate-click] detach failed', error);
      }
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CLICK_AT' && message?.type !== 'CLICK_GRID')
    return false;
  sendResponse({ ok: true, queued: true });
  const gridSize = message.type === 'CLICK_AT' ? 1 : getGridSize(message);
  // Give the popup time to close, then start the sweep.
  clickGrid(
    message.tabId,
    message.x,
    message.y,
    gridSize,
    message.step ?? 10,
    message.intervalMs ?? 180,
    600,
    message.visualize !== false,
  )
    .then((result) =>
      console.log('[coordinate-click] popup sweep completed', result),
    )
    .catch((error) =>
      console.error('[coordinate-click] popup sweep failed', error),
    );
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

// The watcher wakes the worker; all expression checks use User Scripts.
async function checkExpressionRules(sender) {
  if (sender.frameId !== 0 || !sender.documentId) return;
  const tabId = sender.tab?.id;
  if (
    !Number.isInteger(tabId) ||
    queues.has(tabId) ||
    !(await isFocusedTab(tabId))
  )
    return;
  const { autoRules = [] } = await chrome.storage.local.get('autoRules');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || sender.url !== tab.url || queues.has(tabId)) return;
  for (const rule of autoRules) {
    if (
      !rule.enabled ||
      rule.ruleType !== 'expression' ||
      !rule.expression?.trim() ||
      !matchesRuleUrl(tab.url, rule.urlMatch)
    )
      continue;
    let fired = autoFired.get(tabId);
    if (!fired) {
      fired = new Set();
      autoFired.set(tabId, fired);
    }
    if (fired.has(rule.id)) continue;
    const expectedUrl = tab.url;
    const shouldContinue = async () => {
      try {
        if (
          autoFired.get(tabId) !== fired ||
          (await chrome.tabs.get(tabId)).url !== expectedUrl
        )
          return false;
        const value = await evaluateUserRule(
          tabId,
          sender.documentId,
          rule.expression,
        );
        if (
          !value ||
          autoFired.get(tabId) !== fired ||
          (await chrome.tabs.get(tabId)).url !== expectedUrl
        )
          return false;
        fired.add(rule.id);
        return value;
      } catch {
        return false;
      }
    };
    try {
      const result = await clickGrid(
        tabId,
        rule.x,
        rule.y,
        getGridSize(rule),
        rule.step,
        rule.intervalMs,
        0,
        rule.visualize,
        shouldContinue,
        { type: 'expression', ruleId: rule.id },
      );
      if (
        result.stopped &&
        result.completed === 0 &&
        autoFired.get(tabId) === fired
      )
        fired.delete(rule.id);
    } catch (error) {
      if (!(error.completed > 0) && autoFired.get(tabId) === fired)
        fired.delete(rule.id);
      console.warn('[coordinate-click] expression sweep failed', error);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'CHECK_EXPRESSION_RULES') return false;
  checkExpressionRules(sender).catch((error) =>
    console.warn('[coordinate-click] expression check failed', error),
  );
  return false;
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'AUTO_TEXT_FOUND') return false;
  (async () => {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || !(await isFocusedTab(tabId))) return;
    const { autoRules = [] } = await chrome.storage.local.get('autoRules');
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    for (const rule of autoRules) {
      if (
        rule.ruleType === 'expression' ||
        !rule.enabled ||
        !rule.textMatch?.trim()
      )
        continue;
      if (!matchesRuleUrl(tab.url, rule.urlMatch)) continue;
      if (rule.textMatch.toLowerCase() !== message.textMatch) continue;
      // Guard synchronously before starting the asynchronous sweep.
      let fired = autoFired.get(tabId);
      if (!fired) {
        fired = new Set();
        autoFired.set(tabId, fired);
      }
      if (fired.has(rule.id)) continue;
      fired.add(rule.id);
      const frameId = sender.frameId ?? 0;
      const documentId = sender.documentId;
      const expectedUrl = tab.url;
      const needle = rule.textMatch.trim().toLowerCase();
      // Bind the guard to the document that originally matched. If it navigates,
      // disappears, or stops containing the phrase, treat that as a stop signal.
      const shouldContinue = async () => {
        try {
          const currentTab = await chrome.tabs.get(tabId);
          if (currentTab.url !== expectedUrl) return false;
          const options = documentId ? { documentId } : { frameId };
          const response = await chrome.tabs.sendMessage(
            tabId,
            { type: 'CHECK_TEXT_PRESENT', textMatch: needle },
            options,
          );
          return response?.present === true;
        } catch (err) {
          console.log(
            '[coordinate-click] text recheck failed; stopping',
            err.message,
          );
          return false;
        }
      };
      console.log('[coordinate-click] AUTO MATCH', {
        tabId,
        ruleId: rule.id,
        frameId,
        url: tab.url,
      });
      clickGrid(
        tabId,
        rule.x,
        rule.y,
        rule.gridSize ?? rule.radius * 2 + 1,
        rule.step,
        rule.intervalMs,
        0,
        rule.visualize,
        shouldContinue,
        { type: 'text', ruleId: rule.id },
      )
        .then((result) => {
          if (
            result.stopped &&
            result.completed === 0 &&
            autoFired.get(tabId) === fired
          )
            fired.delete(rule.id);
          console.log('[coordinate-click] AUTO FINISHED', rule.id, result);
        })
        .catch((error) => {
          if (!(error.completed > 0) && autoFired.get(tabId) === fired)
            fired.delete(rule.id);
          console.error('[coordinate-click] AUTO FAILED', rule.id, error);
        });
    }
  })().catch((error) =>
    console.warn('[coordinate-click] rule check failed', error),
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
    })().catch((error) =>
      console.warn('[coordinate-click] picker failed', error),
    );
  }
  return false;
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') pickingTabs.delete(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => pickingTabs.delete(tabId));
