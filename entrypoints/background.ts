import { browser } from "wxt/browser";
import { Loop } from "../src/harness/Loop";
import { storeApiKey, storeGoal, getApiKey } from "../src/utils/storage";
import type { BGRequest, BGResponse } from "@/src/utils/shared";

const getCurTabId = async (): Promise<number | null> => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) return null;
  return id;
};

let loop: Loop | null = null;

const setAgentLoop = async () => {
  const key = await getApiKey();
  const tabId = await getCurTabId();
  if (key && tabId !== null) {
    loop = new Loop(key, tabId);
  }
};

export default defineBackground(() => {
  setAgentLoop();

  browser.runtime.onMessage.addListener(
    async (message: any, _sender, _send) => {
      const req = message as BGRequest;
      const sendResponse = (res: BGResponse) => {
        console.log("🚀 ~ sendResponse ~ res:", res);
        _send(res);
      };

      if (req.type === "UPDATE_API_KEY") {
        await storeApiKey(req.apiKey);
        await setAgentLoop();
        sendResponse({ isOk: true, message: "API Key updated" });
      } else if (req.type === "RESET") {
        if (loop) {
          loop.stop();
        }
        await setAgentLoop();
        sendResponse({ isOk: true, message: "Agent loop reset" });
      } else {
        if (!loop) {
          await setAgentLoop();
        }
        if (loop) {
          const res = loop.processEvent(req);
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
