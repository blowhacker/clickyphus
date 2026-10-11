/* exported RULES */
// Packaged default rules. Keep IDs stable; edit settings and conditions here.
const RULES = [
  // To add a rule, uncomment this template and give it a unique stable ID.
  // {
  //   id: 'new-rule',
  //   name: 'My new rule',
  //   enabled: true,
  //   urlMatch: 'example.com',
  //   x: null,
  //   y: null,
  //   gridSize: 1,
  //   step: 10,
  //   intervalMs: 30,
  //   visualize: true,
  //   condition() {
  //     // Replace this with your condition and coordinates.
  //     return false;
  //   },
  // },
];

// You can also append rules with RULES.push({ ... }).
RULES.push({
  id: 'cf-turnstile-click',
  name: 'Auto click cf',
  enabled: true,
  urlMatch: '*',
  x: null,
  y: null,
  gridSize: 10,
  step: 10,
  intervalMs: 80,
  visualize: true,
  condition() {
    const cf =
      [...document.querySelectorAll('meta')].filter((x) =>
        x.content.includes('challenges.cloudflare.com'),
      ).length > 0;
    if (!cf) return false;

    const rectBox = document.querySelectorAll('.main-content div')?.[1];
    if (!rectBox) return false;
    const rect = rectBox.getBoundingClientRect();
    return {
      x: parseInt(rect.left + 30),
      y: parseInt(rect.top + 30),
    };
  },
});
