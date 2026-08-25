import { browser } from "wxt/browser";
import { takeSnapshot } from "@/src/snapshot/snapshot";
import { Agent } from "../src/harness/Agent";
import { storeApiKey, storeGoal } from "../src/utils/storage";
import type { BGRequest, BGResponse } from "@/src/utils/shared";

const getCurTabId = async (): Promise<number | null> => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (id === undefined) return null;
  return id;
};

let activeAgent: Agent | null = null;

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    async (message: any, _sender, _send) => {
      const req = message as BGRequest;
      console.log("🚀 ~ req:", req);
      const sendResponse = (res: BGResponse) => {
        console.log("🚀 ~ sendResponse ~ res:", res);
        _send(res);
      };

      if (req.type === "START") {
        await storeApiKey(req.apiKey);
        await storeGoal(req.goal);

        const id = await getCurTabId();
        if (id !== null && activeAgent === null) {
          activeAgent = new Agent(id, req.apiKey, req.goal);
          await activeAgent.runGameLoop();
        } else {
          console.error("No active tab found");
        }
        sendResponse({ isOk: true, message: "Started" } as BGResponse);
      } else if (req.type === "CAPTURE_SNAPSHOT") {
        const id = await getCurTabId();
        if (id !== null) {
          await takeSnapshot(id);
        }
        sendResponse({ isOk: true, message: "Snapshot started" } as BGResponse);
      } else {
        if (activeAgent) {
          const res = activeAgent.processEvent(req);
          console.log("🚀 ~ ---------res:", res);
          sendResponse(res as BGResponse);
        } else {
          sendResponse({
            isOk: false,
            message: "Req to bg not handled",
          } as BGResponse);
        }
      }
      return true;
    },
  );
});
