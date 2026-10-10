// Runs inside every permitted frame. Only sends matching phrases, not page text.
(() => {
  let rules = [];
  let reported = new Set();
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
      reported.clear();
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
    const needles = new Set(
      rules
        .filter((r) => r.enabled && r.textMatch?.trim())
        .map((r) => r.textMatch.trim().toLowerCase()),
    );
    for (const needle of needles) {
      const key = location.href + '|' + needle;
      if (reported.has(key)) continue;
      if (containsText(document.body || document.documentElement, needle)) {
        reported.add(key);
        chrome.runtime
          .sendMessage({ type: 'AUTO_TEXT_FOUND', textMatch: needle })
          .catch(() => {});
      }
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 450);
  }
  chrome.storage.local.get(['autoRules', 'autoRule']).then((v) => {
    rules =
      v.autoRules || (v.autoRule ? [{ ...v.autoRule, id: 'legacy' }] : []);
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.autoRules) return;
    rules = changes.autoRules.newValue || [];
    reported.clear();
    schedule();
  });
  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  setInterval(scan, 2500);
})();
