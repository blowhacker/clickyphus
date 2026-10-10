// A top-layer overlay captures viewport CSS pixels, including over iframes.
(() => {
  if (window !== window.top) return;
  let cancelPicker;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'START_POINT_PICKER') return false;
    cancelPicker?.(false);
    const overlay = document.createElement('dialog');
    overlay.setAttribute(
      'aria-label',
      'Choose a click position. Escape cancels.',
    );
    overlay.style.cssText =
      'position:fixed;inset:0;margin:0;padding:0;width:100vw;height:100vh;max-width:none;max-height:none;border:0;background:rgba(16,19,22,.08);cursor:crosshair;overflow:hidden;';
    const content = document.createElement('div');
    overlay.append(content);
    const shadow = content.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host::backdrop { background: transparent; }
      .hud { position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#191e23;color:#e6ecef;border:1px solid #4b685e;border-radius:9px;padding:12px 16px;font:12px/1.6 ui-monospace,monospace;box-shadow:0 8px 30px #0005;pointer-events:none;white-space:nowrap; }
      b { color:#79e2bc; } .coords { text-align:center;color:#79e2bc; }
      .h,.v { position:fixed;pointer-events:none;background:#79e2bc;opacity:.6; }
      .h { left:0;right:0;height:1px; } .v { top:0;bottom:0;width:1px; }
    </style><div class="h"></div><div class="v"></div><div class="hud"><b>Pick a position</b> · Click to select · Esc to cancel<div class="coords">Move the pointer to choose X / Y</div></div>`;
    const coords = shadow.querySelector('.coords');
    const horizontal = shadow.querySelector('.h');
    const vertical = shadow.querySelector('.v');
    let timer;
    const finish = (point = null, notify = true) => {
      clearTimeout(timer);
      overlay.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelPicker = null;
      if (notify)
        chrome.runtime
          .sendMessage({ type: 'POINT_PICKER_DONE', point })
          .catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    cancelPicker = (notify = true) => finish(null, notify);
    overlay.addEventListener('pointermove', (event) => {
      const x = Math.round(event.clientX),
        y = Math.round(event.clientY);
      coords.textContent = `X ${x}  /  Y ${y}`;
      horizontal.style.top = `${y}px`;
      vertical.style.left = `${x}px`;
    });
    // Consume the selection without activating the underlying page control.
    overlay.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    overlay.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 0)
        finish({ x: Math.round(event.clientX), y: Math.round(event.clientY) });
    });
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    });
    document.addEventListener('visibilitychange', onVisibility);
    document.documentElement.append(overlay);
    overlay.showModal();
    timer = setTimeout(() => finish(), 60000);
    respond({ ok: true });
    return false;
  });
})();
