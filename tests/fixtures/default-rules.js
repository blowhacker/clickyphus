const RULES = [];

function readyButton() {
  return document.querySelector('button[data-clickyphus-target]');
}
RULES.push({
  id: 'example-js-target',
  name: 'Test ready button',
  enabled: true,
  urlMatch: 'https://example.com/',
  x: null,
  y: null,
  gridSize: 1,
  step: 10,
  intervalMs: 180,
  visualize: true,
  condition() {
    const target = readyButton();
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  },
});
