document.getElementById("form").addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("status");
  status.textContent = "Queueing clicks…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const x = Number(document.getElementById("x").value);
    const y = Number(document.getElementById("y").value);
    const radius = Number(document.getElementById("radius").value);
    const step = Number(document.getElementById("step").value);
    const intervalMs = Number(document.getElementById("interval").value);
    const result = await chrome.runtime.sendMessage({
      type: "CLICK_GRID", tabId: tab.id, x, y, radius, step, intervalMs, visualize: document.getElementById("visualize").checked
    });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    window.close();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
});


// Automatic rule settings, persisted locally on this Chrome profile.
const fields = {
  enabled: 'autoEnabled', urlMatch: 'urlMatch', textMatch: 'textMatch',
  x: 'autoX', y: 'autoY', radius: 'autoRadius', step: 'autoStep',
  intervalMs: 'autoInterval', visualize: 'autoVisualize'
};
chrome.storage.local.get('autoRule').then(({ autoRule }) => {
  if (!autoRule) return;
  for (const [key, id] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (autoRule[key] === undefined) continue;
    if (el.type === 'checkbox') el.checked = autoRule[key];
    else el.value = autoRule[key];
  }
});

document.getElementById('auto-form').addEventListener('submit', async event => {
  event.preventDefault();
  const get = key => document.getElementById(fields[key]);
  const autoRule = {
    enabled: get('enabled').checked,
    urlMatch: get('urlMatch').value.trim(),
    textMatch: get('textMatch').value.trim(),
    x: Number(get('x').value), y: Number(get('y').value),
    radius: Number(get('radius').value), step: Number(get('step').value),
    intervalMs: Number(get('intervalMs').value),
    visualize: get('visualize').checked
  };
  const status = document.getElementById('autoStatus');
  if (!autoRule.urlMatch || !autoRule.textMatch ||
      !Number.isInteger(autoRule.x) || autoRule.x < 0 ||
      !Number.isInteger(autoRule.y) || autoRule.y < 0) {
    status.textContent = 'Please provide both match conditions and valid coordinates.';
    return;
  }
  await chrome.storage.local.set({ autoRule });
  status.textContent = autoRule.enabled ? 'Saved and enabled.' : 'Saved (disabled).';
});
