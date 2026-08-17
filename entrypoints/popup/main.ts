import { browser } from "wxt/browser";

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const goalInput = document.getElementById("goal") as HTMLTextAreaElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;

browser.storage.local.get(["geminiApiKey", "agentGoal"]).then((res: any) => {
  if (res.geminiApiKey) apiKeyInput.value = res.geminiApiKey;
  if (res.agentGoal) goalInput.value = res.agentGoal;
});

startBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const goal = goalInput.value.trim();

  if (!apiKey) {
    alert("Please enter your Gemini API Key first.");
    return;
  }
  if (!goal) {
    alert("Please enter a goal.");
    return;
  }

  await browser.storage.local.set({ geminiApiKey: apiKey, agentGoal: goal });
  startBtn.disabled = true;
  await browser.runtime.sendMessage({ action: "START", goal });
});

const snapshotBtn = document.getElementById("snapshot-btn") as HTMLButtonElement;
if (snapshotBtn) {
  snapshotBtn.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ action: "SNAPSHOT" });
  });
}
