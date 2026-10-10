document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("status");
  status.textContent = "Queuing click…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    const x = Number(document.getElementById("x").value);
    const y = Number(document.getElementById("y").value);
    const result = await chrome.runtime.sendMessage({ type: "CLICK_AT", tabId: tab.id, x, y });
    if (!result?.ok) throw new Error(result?.error || "Unknown error");
    window.close(); // Let Chrome dismiss the popup before input is dispatched.
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  }
});
