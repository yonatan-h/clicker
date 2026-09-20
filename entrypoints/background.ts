import { browser } from "wxt/browser";
import { Loop } from "../src/harness/Loop";
import {
  storeGeminiApiKey,
  storeGoal,
  getGeminiApiKey,
  storeJevApiKey,
  getJevApiKey,
} from "../src/utils/storage";
import type { BGRequest, BGResponse } from "@/src/utils/shared";

const getCurTabId = async (): Promise<number | null> => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) return null;
  return id;
};

let loop: Loop | null = null;

const setAgentLoop = async () => {
  const geminiApiKey = await getGeminiApiKey();
  const jevApiKey = await getJevApiKey();
  const tabId = await getCurTabId();
  if (geminiApiKey && jevApiKey && tabId !== null) {
    loop = new Loop(geminiApiKey, jevApiKey);
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

      if (req.type === "UPDATE_API_KEYS") {
        await Promise.all([
          storeGeminiApiKey(req.geminiApiKey),
          storeJevApiKey(req.jevApiKey),
        ]);
        await setAgentLoop();
        sendResponse({ isOk: true, message: "API Keys updated" });
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
          const res = await loop.processEvent(req);
          sendResponse(res);
        } else {
          sendResponse({
            isOk: false,
            message: `Req to bg not handled: ${JSON.stringify(req)}`,
          });
        }
      }
      return true;
    },
  );
});
