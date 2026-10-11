// Runs inside every permitted frame. Only sends matching phrases, not page text.
(() => {
  let rules = [];
  const pending = new Set();
  let scheduled = false;

  function containsText(root, needle) {
    if (!root) return false;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    const pieces = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement?.closest('script,style,noscript,template'))
          continue;
        pieces.push(node.nodeValue);
      } else if (node.shadowRoot) {
        if (containsText(node.shadowRoot, needle)) return true;
      }
    }
    return pieces.join(' ').toLowerCase().includes(needle);
  }

  // Background worker checks this before each click. Always scan the live DOM,
  // rather than trusting the one-time AUTO_TEXT_FOUND notification.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RECHECK_AUTO_RULES') {
      scan();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type !== 'CHECK_TEXT_PRESENT') return false;
    const needle = message.textMatch?.trim().toLowerCase();
    sendResponse({
      present:
        !!needle &&
        containsText(document.body || document.documentElement, needle),
    });
    return false;
  });

  function scan() {
    scheduled = false;
    if (document.readyState === 'loading') return;
    if (
      window === window.top &&
      rules.some(
        (r) =>
          r.enabled &&
          (r.ruleType === 'bundled' ||
            (r.ruleType === 'expression' && r.expression?.trim())),
      )
    ) {
      chrome.runtime
        .sendMessage({ type: 'CHECK_EXPRESSION_RULES' })
        .catch(() => {});
    }
    const needles = new Set(
      rules
        .filter(
          (r) =>
            r.enabled &&
            !['expression', 'bundled'].includes(r.ruleType) &&
            r.textMatch?.trim(),
        )
        .map((r) => r.textMatch.trim().toLowerCase()),
    );
    for (const needle of needles) {
      const key = location.href + '|' + needle;
      if (pending.has(key)) continue;
      if (containsText(document.body || document.documentElement, needle)) {
        pending.add(key);
        chrome.runtime
          .sendMessage({ type: 'AUTO_TEXT_FOUND', textMatch: needle })
          .catch(() => {})
          .finally(() => pending.delete(key));
      }
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 450);
  }
  // DOM readiness is enough: slow images must not block rule evaluation.
  // Retry early for app initialization, then keep the regular polling below.
  function startChecks() {
    schedule();
    setTimeout(scan, 1000);
    setTimeout(scan, 2000);
  }
  document.addEventListener('DOMContentLoaded', startChecks, { once: true });
  window.addEventListener('load', schedule, { once: true });
  window.addEventListener('pageshow', startChecks);
  chrome.storage.local.get(['autoRules', 'autoRule']).then((v) => {
    rules =
      v.autoRules || (v.autoRule ? [{ ...v.autoRule, id: 'legacy' }] : []);
    if (document.readyState !== 'loading') startChecks();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoRules) return;
    rules = changes.autoRules.newValue || [];
    schedule();
  });
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  setInterval(scan, 2500);
})();
