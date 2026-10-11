/* exported createRuleEvaluator */
// Owns document-bound condition execution and saved-coordinate fallback.
// Every successful evaluation returns { x, y }; every non-match returns false.
function createRuleEvaluator({ defaultRules }) {
  // User-entered code is compiled in an isolated user-script world, then injected
  // directly in MAIN so DOM/page globals work even when the page forbids eval.
  const compiledRules = new Map();
  const compilerWorld = 'clickyphus-compiler';

  async function evaluateBundledRule(tabId, documentId, ruleId) {
    if (!ruleId) return false;
    const [evaluation] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      world: 'MAIN',
      func: defaultRules,
      args: [ruleId],
      // Don't defer checks until all images finish loading.
      injectImmediately: true,
    });
    if (evaluation?.documentId !== documentId) return false;
    return evaluation.result;
  }

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
        console.warn('[clickyphus] JS rule failed:', error);
        return false;
      }
    })(${compiled})`,
        },
      ],
    });
    if (evaluation?.error || evaluation?.documentId !== documentId)
      return false;
    return evaluation.result;
  }

  async function evaluate(rule, tabId, sender) {
    let value;
    if (rule.ruleType === 'expression') {
      value = await evaluateUserRule(tabId, sender.documentId, rule.expression);
    } else if (rule.ruleType === 'bundled') {
      value = await evaluateBundledRule(
        tabId,
        sender.documentId,
        rule.builtinId,
      );
    } else {
      const target = sender.documentId
        ? { documentId: sender.documentId }
        : { frameId: sender.frameId ?? 0 };
      const response = await chrome.tabs.sendMessage(
        tabId,
        {
          type: 'CHECK_TEXT_PRESENT',
          textMatch: rule.textMatch.trim().toLowerCase(),
        },
        target,
      );
      value = response?.present === true;
    }
    // All automatic rules expose one contract to the runner and grid executor.
    const center = value === true ? { x: rule.x, y: rule.y } : value;
    return center &&
      typeof center === 'object' &&
      Number.isFinite(center.x) &&
      Number.isFinite(center.y) &&
      center.x >= 0 &&
      center.y >= 0
      ? { x: center.x, y: center.y }
      : false;
  }
  return evaluate;
}
