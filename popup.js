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
      type: "CLICK_GRID", tabId: tab.id, x, y, radius, step, intervalMs
    });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    window.close();
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
});
