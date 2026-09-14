import { browser } from "wxt/browser";
import type { TreeNode } from "../harness/tools/tree";

export const ID_ATTR = "data-clicker4jf8-id";

export type UIState = {
  targetId: number | null;
  isThinking: boolean;
  isRunning: boolean;
  thoughts: string[];
};

export type UIResponse = { message: string; isError: boolean };

export type BGRequest =
  | {
      type: "START";
      text: string;
    }
  | {
      type: "UPDATE_API_KEY";
      apiKey: string;
    }
  | {
      type: "CAPTURE_SNAPSHOT";
    }
  | {
      type: "STOP";
    }
  | {
      type: "GET_STATE";
    }
  | {
      type: "RESET";
    };

export type BGResponse = {
  message: string;
  isOk: boolean;
  state?: UIState | null;
};

export type SnapshotResult =
  | {
      success: true;
      root: TreeNode;
      pageTitle: string;
      pageUrl: string;
    }
  | {
      success: false;
      root: null;
      pageTitle: string;
      pageUrl: string;
      error: string;
    };

export const sendToBg = async (req: BGRequest): Promise<BGResponse> => {
  try {
    const res = await browser.runtime.sendMessage(req);
    return (
      (res as BGResponse) || {
        isOk: false,
        message: "No response from background",
      }
    );
  } catch (err: any) {
    return { isOk: false, message: JSON.stringify(err) };
  }
};
