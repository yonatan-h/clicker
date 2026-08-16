import { browser } from "wxt/browser";

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

browser.storage.local.get("geminiApiKey").then((res:{geminiApiKey?: string}) => {
  if (res.geminiApiKey) {
    apiKeyInput.value = res.geminiApiKey;
  }
});

startBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    alert("Please enter your Gemini API Key first.");
    return;
  }

  await browser.storage.local.set({ geminiApiKey: apiKey });
  startBtn.disabled = true;
  await browser.runtime.sendMessage({ action: "START" });
});

const snapshotBtn = document.getElementById("snapshot-btn") as HTMLButtonElement;
if (snapshotBtn) {
  snapshotBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "SNAPSHOT" });
  });
}
