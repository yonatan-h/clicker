import { browser } from "wxt/browser";
import { takeSnapshot } from "@/src/snapshot/snapshot";
import { Agent } from "../src/harness/Agent";
import { storeApiKey, storeGoal, getApiKey } from "../src/utils/storage";
import type { BGRequest, BGResponse } from "@/src/utils/shared";

const getCurTabId = async (): Promise<number | null> => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) return null;
  return id;
};

let activeAgent: Agent | null = null;

const initAgent = async () => {
  const key = await getApiKey();
  if (key) {
    activeAgent = new Agent(key);
  } else {
    activeAgent = null;
  }
};

export default defineBackground(() => {
  initAgent();

  browser.runtime.onMessage.addListener(
    async (message: any, _sender, _send) => {
      const req = message as BGRequest;
      console.log("🚀 ~ req:", req);
      const sendResponse = (res: BGResponse) => {
        console.log("🚀 ~ sendResponse ~ res:", res);
        _send(res);
      };

      if (req.type === "UPDATE_API_KEY") {
        await storeApiKey(req.apiKey);
        await initAgent();
        sendResponse({ isOk: true, message: "API Key updated" });
      } else if (req.type === "CAPTURE_SNAPSHOT") {
        const id = await getCurTabId();
        if (id !== null) {
          await takeSnapshot(id);
        }
        sendResponse({ isOk: true, message: "Snapshot started" });
      } else {
        if (activeAgent) {
          if (_sender.tab?.id) {
            activeAgent.tabId = _sender.tab.id;
          }
          const res = activeAgent.processEvent(req);
          sendResponse(res);
        } else {
          sendResponse({
            isOk: false,
            message: "Req to bg not handled",
          });
        }
      }
      return true;
    },
  );
});
