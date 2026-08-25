import { browser } from "wxt/browser";

export const ID_ATTR = "data-clicker4jf8-id";

export type UIRequest =
  | { type: "UPDATE_THINKING"; isThinking:boolean  }
  | { type: "SHOW_THOUGHT"; text: string | null }
  | { type: "MOVE_CURSOR"; id: number }
  | { type: "DO_CLICK"; id: number }
  | { type: "DO_TYPE"; id: number; text: string };

export type UIResponse = { message: string; isError: boolean };

export type BGRequest =
  | {
      type: "START";
      goal: string;
      apiKey: string;
    }
  | {
      type: "CAPTURE_SNAPSHOT";
    }
  | {
      type: "STOP";
    };

export type BGResponse = {
  message: string;
  isOk: boolean;
};

export type SnapshotResult =
  | { success: true; snapshot: string; pageTitle: string; pageUrl: string }
  | {
      success: false;
      snapshot: string;
      pageTitle: string;
      pageUrl: string;
      error: string;
    };

export const sendToBg = async (req: BGRequest): Promise<BGResponse> => {
  try {
    const res = await browser.runtime.sendMessage(req);
    return (res as BGResponse) || { isOk: false, message: "No response from background" };
  } catch (err: any) {
    return { isOk: false, message: JSON.stringify(err) };
  }
};

export const sendToUI = async (tabId: number, req: UIRequest): Promise<UIResponse> => {
  try {
    const res = await browser.tabs.sendMessage(tabId, req);
    return (res as UIResponse) || { isError: true, message: "No response from UI" };
  } catch (err: any) {
    return { isError: true, message: JSON.stringify(err) };
  }
};
