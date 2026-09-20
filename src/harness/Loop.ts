import { browser } from "wxt/browser";
import { type BGRequest, type BGResponse, type UIState } from "../utils/shared";
import { GoogleGenAI, PairwiseChoice } from "@google/genai";
import { getGoal, storeGoal } from "../utils/storage";
import { Interactor } from "./Interactor";
import { TypeSafeClient } from "@typesafe-ai/sdk";

export type HistoryContentItem = {
  role: "user" | "model";
  parts: { text: string }[];
};
type Listener = {
  type: BGRequest["type"];
  id: number;
  resolve: (event: BGRequest) => void;
};

export class StopInterrupt extends Error {
  constructor() {
    super("Stopped by user");
  }
}
export class Loop {
  private interactor: Interactor;
  private tabId: number;
  private geminiApiKey: string;
  private jevApiKey: string;
  private listeners: Listener[];
  private isSlowMo: boolean;

  public uiState: UIState = {
    targetId: null,
    isRunning: false,
    isThinking: false,
    thoughts: [],
    lastInput: "",
    awaitedAnimMs: 0,
    ask: null,
  };

  constructor(geminiApiKey: string, jevApiKey: string) {
    this.geminiApiKey = geminiApiKey;
    this.jevApiKey = jevApiKey;
    this.tabId = -1;
    this.interactor = new Interactor(this);
    this.listeners = [];
    this.isSlowMo = false;
    getGoal().then((g) => {
      this.syncUI({ lastInput: g ?? "" });
    });
  }
  
  public interruptIfStopped(){
    if (!this.uiState.isRunning){
      throw new StopInterrupt();
    }
  }

  public setSlowMo() {
    this.isSlowMo = true;
  }

  public async syncUI(partial?: Partial<UIState> & { thought?: string }) {
    const oldAnimMs = this.uiState.awaitedAnimMs;
    if (this.tabId === null) return;
    if (partial) {
      const { thought, ...rest } = partial;
      let newThoughts = rest.thoughts ?? this.uiState.thoughts;
      if (thought !== undefined && thought !== null) {
        newThoughts = [...newThoughts, thought];
      }
      this.uiState = {
        ...this.uiState,
        ...rest,
        thoughts: newThoughts,
      };
    }

    try {
      await browser.tabs.sendMessage(this.tabId, this.uiState);
      if (partial?.awaitedAnimMs) {
        await this.sleep(partial.awaitedAnimMs);
        await this.syncUI({ awaitedAnimMs: oldAnimMs });
      }
    } catch (err: any) {
      return { isError: true, message: JSON.stringify(err) };
    }
  }

  public listen(type: BGRequest["type"], id: number): Promise<BGRequest> {
    return new Promise((resolve) => {
      this.listeners.push({ type, id, resolve });
    });
  }

  public stop() {
    this.syncUI({
      thought: "Stopped by user",
      isRunning: false,
      isThinking: false,
      targetId: null,
    });
  }
  public async processEvent(event: BGRequest): Promise<BGResponse> {
    if (event.type === "STOP") {
      this.stop();
      return { isOk: true, message: "Stopped" };
    }

    if (event.type === "GET_STATE") {
      return { isOk: true, message: "State retrieved", state: this.uiState };
    }

    if (event.type === "START") {
      if (this.uiState.isRunning) {
        return { isOk: false, message: "Cannot start while running" };
      }

      try {
        const tabs = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tab = tabs[0];
        if (tab?.id === undefined) throw "Could not get tab";
        this.tabId = tab.id;
        storeGoal(event.text);
        this.runGameLoop(event.text);
      } catch (e: any) {
        this.syncUI({ thought: `${e}` });
        return { isOk: false, message: `${e}` };
      }
      return { isOk: true, message: "Started" };
    }

    for (let i = 0; i < this.listeners.length; i++) {
      const l = this.listeners[i];
      if (l && "id" in event && l.id === event.id && l.type === event.type) {
        l.resolve(event);
        this.listeners.splice(i, 1);
        return { isOk: true, message: "Handled by listener" };
      }
    }

    return { isOk: false, message: `Unknown event type ${event.type}` };
  }

  sleep(ms: number) {
    if (this.isSlowMo) {
      ms = ms * 3000 + 3000;
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTabId() {
    return this.tabId;
  }

  async runGameLoop(userText: string) {
    if (this.uiState.isRunning) {
      return console.log("already running");
    }
    await this.interactor.seedConvo(userText);
    this.syncUI({ isRunning: true, thought: userText });

    const jev = new TypeSafeClient({ apiKey: this.jevApiKey });
    const gemini = new GoogleGenAI({ apiKey: this.geminiApiKey });
    await this.interactor.gameLoop(jev, gemini);

    if (this.uiState.isRunning) {
      this.stop();
    }
  }
}
