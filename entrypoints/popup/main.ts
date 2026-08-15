import { browser } from "wxt/browser";

const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const continueBtn = document.getElementById("continue-btn") as HTMLButtonElement;
const messageEl = document.getElementById("message") as HTMLParagraphElement;
const askUserPromptEl = document.getElementById("ask-user-prompt") as HTMLDivElement;

// Load stored API key
browser.storage.local.get("geminiApiKey").then((res: { geminiApiKey?: string }) => {
  if (res?.geminiApiKey) {
    apiKeyInput.value = res.geminiApiKey;
  }
});

// Auto-save API key on input
apiKeyInput.addEventListener("input", () => {
  browser.storage.local.set({ geminiApiKey: apiKeyInput.value.trim() });
});

// Check if there's a pending ask_user prompt
async function checkState() {
  const response = (await browser.runtime.sendMessage({ action: "GET_STATE" })) as
    | { pendingAskUser: string | null }
    | undefined;
  if (response?.pendingAskUser) {
    askUserPromptEl.textContent = response.pendingAskUser;
    askUserPromptEl.style.display = "block";
    startBtn.style.display = "none";
    continueBtn.style.display = "block";
    messageEl.textContent = "Fill in what's needed, then click Continue.";
  } else {
    askUserPromptEl.style.display = "none";
    startBtn.style.display = "block";
    continueBtn.style.display = "none";
    messageEl.textContent = "";
  }
}

startBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    messageEl.textContent = "Please enter your Gemini API Key first.";
    return;
  }
  await browser.storage.local.set({ geminiApiKey: apiKey });
  messageEl.textContent = "Agent started...";
  startBtn.disabled = true;
  await browser.runtime.sendMessage({ action: "START" });
});

continueBtn.addEventListener("click", async () => {
  messageEl.textContent = "Resuming...";
  continueBtn.disabled = true;
  await browser.runtime.sendMessage({ action: "CONTINUE" });
  askUserPromptEl.style.display = "none";
  continueBtn.style.display = "none";
  startBtn.style.display = "block";
  startBtn.disabled = false;
  messageEl.textContent = "Agent resumed.";
});

// Check state when popup opens
checkState();

