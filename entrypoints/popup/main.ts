import { browser } from "wxt/browser";

document.getElementById("click-me")?.addEventListener("click", async () => {
  const msgEl = document.getElementById("message");
  if (!msgEl) return;

  msgEl.textContent = "Processing in background...";
  await browser.runtime.sendMessage({ action: "START" });
});

