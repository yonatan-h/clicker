import { browser } from "wxt/browser";

document.getElementById("click-me")?.addEventListener("click", async () => {
  const msgEl = document.getElementById("message");
  if (!msgEl) return;

  const localhostTabs = await browser.tabs.query({ url: "http://localhost:7092/*" });
  const chatGptTabs = await browser.tabs.query({ url: "*://chatgpt.com/*" });

  if (localhostTabs.length !== 1 || chatGptTabs.length === 0) {
    msgEl.textContent = `Error: Need exactly 1 localhost tab (found ${localhostTabs.length}) and at least 1 ChatGPT tab (found ${chatGptTabs.length}).`;
    return;
  }

  msgEl.textContent = "Processing...";

  const localhostTab = localhostTabs[0];
  const chatTabId = chatGptTabs[0].id!;

  const [{ result: spanText }] = await browser.scripting.executeScript({
    target: { tabId: localhostTab.id! },
    func: () => document.querySelector("span")?.innerText ?? "",
  });

  await browser.tabs.update(chatTabId, { active: true });

  const prompt = `Here is the text from my app: "${spanText}"\nWhat do you think?`;
  await browser.scripting.executeScript({
    target: { tabId: chatTabId },
    func: (text: string) => {
      const input = document.querySelector("#prompt-textarea") as HTMLElement;
      input.focus();

      const data = new DataTransfer();
      data.setData("text/plain", text);
      input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));

      setTimeout(() => {
        (document.querySelector('[data-testid="send-button"]') as HTMLElement)?.click();
      }, 500);
    },
    args: [prompt],
  });

  msgEl.textContent = "Done!";
});

