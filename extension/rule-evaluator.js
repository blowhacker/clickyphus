/* exported evaluateRules */
// Runtime behavior lives here; default-rules.js is only configuration.
function evaluateRules(rules, ruleId) {
  if (ruleId === undefined) {
    return rules.map(({ condition, ...rule }) =>
      condition ? { ...rule, ruleType: 'bundled', builtinId: rule.id } : rule,
    );
  }
  // Normalize here so promises cannot be implicitly awaited by executeScript.
  try {
    const value = rules.find((rule) => rule.id === ruleId)?.condition?.();
    if (value === true) return true;
    if (!value || typeof value !== 'object' || typeof value.then === 'function')
      return false;
    const x = value.x ?? value.X;
    const y = value.y ?? value.Y;
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0
      ? { x, y }
      : false;
  } catch (error) {
    console.warn('[clickyphus] built-in rule failed:', error);
    return false;
  }
}
