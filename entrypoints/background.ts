import { browser } from "wxt/browser";
import { takeSnapshot } from "@/src/snapshot/snapshot";
import { Agent } from "../src/harness/Agent";
import { getApiKey } from "../src/utils/storage";

const getCurTabId = async (): Promise<number | null> => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) return null;
  return id;
};

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    async (message: any, _sender, sendResponse) => {
      if (message?.action === "START") {
        const id = await getCurTabId();
        if (id !== null) {
          const geminiApiKey = await getApiKey();

          if (!geminiApiKey) {
            console.error("Gemini API key not configured.");
            return;
          }
          const agent = new Agent(id, geminiApiKey, message.goal);
          await agent.runGameLoop();
        } else {
          console.error("No active tab found");
        }
        sendResponse({ started: true });
      } else if (message?.action === "SNAPSHOT") {
        const id = await getCurTabId();
        if (id !== null) {
          await takeSnapshot(id);
        }
        sendResponse({ snapshotStarted: true });
      }
      return true;
    },
  );
});
