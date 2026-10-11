/* global document, window */
// Serialized for execution in the page; this function cannot use worker closures.
function drawClickMarker(x, y, index, total, clicked) {
  const id = '__clickyphus_visualizer__';
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement('div');
    host.id = id;
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden';
    (document.documentElement || document.body).appendChild(host);
  }
  const dot = document.createElement('div');
  dot.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);width:24px;height:24px;border:3px solid #ff214f;border-radius:50%;background:rgba(255,33,79,.22);box-shadow:0 0 0 2px white,0 0 12px #ff214f;box-sizing:border-box`;
  const h = document.createElement('div');
  h.style.cssText = `position:absolute;left:${x - 16}px;top:${y}px;width:32px;border-top:1px solid #ff214f`;
  const v = document.createElement('div');
  v.style.cssText = `position:absolute;left:${x}px;top:${y - 16}px;height:32px;border-left:1px solid #ff214f`;
  const label = document.createElement('div');
  label.textContent = `${index}/${total} (${x},${y})`;
  label.style.cssText = `position:absolute;left:${x - 18}px;top:${y + 13}px;transform:translateX(-100%);background:#151515;color:#fff;border:1px solid #ff214f;padding:3px 6px;border-radius:4px;white-space:nowrap;font:12px monospace`;
  host.replaceChildren(dot, h, v, label);
  // Use the click index so aim and fire share a pose and each sweep restarts.
  const phase = (index - 1) % 12;
  const angle = -30 + 10 * (phase <= 6 ? phase : 12 - phase);
  const radians = (angle * Math.PI) / 180;
  const distance = Math.max(
    32,
    Math.min(160, (window.innerWidth - 85 - x) / Math.cos(radians)),
  );
  const muzzleX = x + distance * Math.cos(radians);
  const muzzleY = y + distance * Math.sin(radians);
  const rotation = `rotate(${angle}deg)`;
  const gun = document.createElement('div');
  gun.style.cssText = `position:absolute;left:${muzzleX}px;top:${muzzleY}px;transform:${rotation};transform-origin:0 0;pointer-events:none;filter:drop-shadow(0 3px 6px #0008)`;
  const ns = 'http://www.w3.org/2000/svg';
  function svgElement(tag, attributes) {
    const element = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, value);
    return element;
  }
  const svg = svgElement('svg', {
    viewBox: '0 0 108 74',
    width: '108',
    height: '74',
    'aria-hidden': 'true',
  });
  svg.style.cssText = 'position:absolute;left:-23px;top:-18px;overflow:visible';
  const artwork = svgElement('g', {
    transform: 'translate(108 0) scale(-1 1)',
  });
  artwork.append(
    svgElement('path', {
      d: 'M14 18 Q12 10 22 10 H82 V29 H48 L36 63 H18 L27 28 H14Z',
      fill: '#678f73',
      stroke: '#c9f6b0',
      'stroke-width': '2.5',
      'stroke-linejoin': 'round',
    }),
    svgElement('path', { d: 'M15 10 H85 V20 H15Z', fill: '#d2e5d0' }),
    svgElement('path', { d: 'M27 36 L21 57 H32 L40 36Z', fill: '#243d2d' }),
    svgElement('path', {
      d: 'M45 30 Q55 40 43 44',
      fill: 'none',
      stroke: '#c9f6b0',
      'stroke-width': '3',
    }),
    svgElement('path', {
      d: 'M21 14 H70',
      stroke: '#56755d',
      'stroke-width': '3',
    }),
  );
  const flash = svgElement('path', {
    d: 'M85 13 L98 6 L94 14 L108 17 L95 21 L99 30 L85 23Z',
    fill: '#efffc6',
    opacity: '0',
  });
  artwork.append(flash);
  svg.append(artwork);
  gun.append(svg);
  host.append(gun);
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  if (clicked) {
    label.textContent = 'Clicked · ' + label.textContent;
    dot.style.background = '#ff214f';
    if (!reducedMotion) {
      gun.animate(
        [
          { transform: rotation },
          {
            transform: `${rotation} translateX(9px) rotate(5deg)`,
            offset: 0.2,
          },
          { transform: rotation },
        ],
        { duration: 200, easing: 'ease-out' },
      );
      flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100 });
      const bullet = document.createElement('div');
      bullet.style.cssText = `position:absolute;left:${muzzleX}px;top:${muzzleY - 2}px;transform-origin:0 50%;width:24px;height:4px;background:#edffc6;box-shadow:0 0 12px #bcff80;border-radius:5px`;
      host.append(bullet);
      bullet.animate(
        [
          { transform: `${rotation} translateX(-24px)`, opacity: 1 },
          { transform: `${rotation} translateX(${-distance}px)`, opacity: 0 },
        ],
        { duration: 120, easing: 'ease-out', fill: 'forwards' },
      );
      const ripple = document.createElement('div');
      ripple.style.cssText = dot.style.cssText;
      ripple.style.background = 'transparent';
      ripple.style.borderColor = '#edffc6';
      host.append(ripple);
      ripple.animate(
        [
          { transform: 'translate(-50%,-50%) scale(.65)', opacity: 1 },
          { transform: 'translate(-50%,-50%) scale(2.5)', opacity: 0 },
        ],
        { duration: 280, delay: 100, easing: 'ease-out', fill: 'forwards' },
      );
    }
  }
  clearTimeout(window.__coordinateClickMarkerTimer);
  window.__coordinateClickMarkerTimer = setTimeout(() => host.remove(), 1600);
}

/* exported createGridExecutor */
// Owns grid geometry, per-tab serialization, markers, and browser input.
// The caller supplies focus/continuation checks and optional execution history.
function createGridExecutor({ isFocusedTab }) {
  const queues = new Map();
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

  // Overlay lives in the top-level document, above nested cross-origin frames.
  // pointer-events:none prevents the marker itself from swallowing clicks.
  async function showMarker(target, x, y, index, total, clicked = false) {
    const source = `(${drawClickMarker.toString()})(...${JSON.stringify([x, y, index, total, clicked])})`;
    try {
      await chrome.debugger.sendCommand(target, 'Runtime.evaluate', {
        expression: source,
        returnByValue: true,
      });
    } catch (error) {
      console.warn('[clickyphus] overlay unavailable:', error.message);
    }
  }

  async function run({
    tabId,
    x,
    y,
    gridSize = 3,
    step = 10,
    intervalMs = 180,
    startDelayMs = 0,
    visualize = true,
    shouldContinue = null,
    onStart,
  }) {
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
        const center = condition;
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
        // Resolve the evaluated center once; keep the grid fixed during
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
          x = condition.x;
          y = condition.y;
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
          console.warn('[clickyphus] invalid sweep center');
          return {
            ok: true,
            stopped: true,
            reason: 'invalid_coordinates',
            tabId,
            completed: 0,
          };
        }
        const points = pointsAround(x, y, gridSize, step);
        console.log('[clickyphus] resolved sweep center', {
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
              '[clickyphus] AUTO STOP: matching text disappeared or frame unavailable',
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
            console.log('[clickyphus] AUTO STOP before mouse press', {
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
          if (completed === 0 && onStart) {
            try {
              await onStart({ tabId, center: { x, y }, firstPoint: pt });
            } catch (error) {
              console.warn('[clickyphus] before-click callback failed', error);
            }
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
            await showMarker(
              target,
              pt.x,
              pt.y,
              completed,
              points.length,
              true,
            );
          }
          console.log(`[clickyphus] ${completed}/${points.length}`, pt);
          if (completed < points.length) await sleep(intervalMs);
        }
        return { ok: true, tabId, completed, points };
      } catch (error) {
        console.error('[clickyphus] sweep interrupted', {
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
          console.warn('[clickyphus] detach failed', error);
        }
      }
    });
  }

  async function whenIdle(tabId) {
    while (queues.has(tabId)) {
      await queues.get(tabId).catch(() => {});
    }
  }

  return { run, whenIdle, isBusy: (tabId) => queues.has(tabId) };
}
