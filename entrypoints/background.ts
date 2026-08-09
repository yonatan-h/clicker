import { browser } from "wxt/browser";


export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      "action" in message &&
      (message as { action: unknown }).action === "START"
    ) {
      runAgentLoop();
    }
  });
});

async function runAgentLoop() {
  const localhostTabs = await browser.tabs.query({
    url: "http://localhost:7092/*",
  });
  const chatGptTabs = await browser.tabs.query({ url: "*://chatgpt.com/*" });

  if (localhostTabs.length !== 1 || chatGptTabs.length === 0) {
    console.error(`Error: Need exactly 1 localhost tab (found ${localhostTabs.length}) and at least 1 ChatGPT tab (found ${chatGptTabs.length}).`);
    return;
  }

  const localhostTab = localhostTabs[0];
  const chatTabId = chatGptTabs[0].id!;

  const [{ result: spanText }] = await browser.scripting.executeScript({
    target: { tabId: localhostTab.id! },
    func: () => document.querySelector("span")?.innerText ?? "",
  });

  await browser.tabs.update(chatTabId, { active: true });

  const prompt = `Here is the text from my app: "${spanText ?? ""}"\nReply with exactly 'CLICK_ANY_BUTTON' if I should click a button, followed by '[DONE]' when you are finished.`;
  await browser.scripting.executeScript({
    target: { tabId: chatTabId },
    func: (text: string) => {
      const input = document.querySelector("#prompt-textarea") as HTMLElement;
      input.focus();

      const data = new DataTransfer();
      data.setData("text/plain", text);
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );

      setTimeout(() => {
        (
          document.querySelector('[data-testid="send-button"]') as HTMLElement
        )?.click();
      }, 500);
    },
    args: [prompt],
  });

  while (true) {
    await new Promise((r) => setTimeout(r, 1000));

    const [{ result: response }] = await browser.scripting.executeScript({
      target: { tabId: chatTabId },
      func: () => {
        const messages = document.querySelectorAll(
          '[data-message-author-role="assistant"]',
        );
        if (!messages.length) return "";
        return (messages[messages.length - 1] as HTMLElement).innerText;
      },
    });
    
    if (typeof response !== "string") {
      console.error("Error: ChatGPT did not respond with text.");
      break;
    }

    if (response && response.includes("[DONE]")) {
      if (response.includes("CLICK_ANY_BUTTON")) {
        console.log("Clicking button on localhost...");
        await browser.scripting.executeScript({
          target: { tabId: localhostTab.id! },
          func: () => document.querySelector("button")?.click(),
        });
        await browser.tabs.update(localhostTab.id!, { active: true });
        console.log("Done! Button clicked.");
      } else {
        console.log("Done! No click command found.");
      }
      break;
    }
  }
}
