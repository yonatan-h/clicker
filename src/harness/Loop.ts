import { browser } from "wxt/browser";
import { type BGRequest, type BGResponse, type UIState } from "../utils/shared";
import { getGoal } from "../utils/storage";
import { Interactor } from "./Interactor";
import { Usage } from "./Usage";

export type HistoryContentItem = {
  role: "USER" | "MODEL";
  parts: { text: string }[];
};

type CallModelResult =
  | { success: true; response: string; sleepMs: number }
  | { success: false; error: string; sleepMs: number };

export class Loop {
  private interactor: Interactor;
  private usage: Usage;
  private tabId: number;
  private apiKey: string;

  constructor(apiKey: string, tabId: number) {
    this.apiKey = apiKey;
    this.tabId = tabId;
    this.interactor = new Interactor(this);
    this.usage = new Usage({
      reqPerMin: 30,
      tokenPerMin: 16000,
      reqPerDay: 14400,
    });
  }

  public uiState: UIState = {
    targetId: null,
    isRunning: false,
    isThinking: false,
    thoughts: [],
  };

  public async syncUI(partial?: Partial<UIState> & { thought?: string }) {
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
    } catch (err: any) {
      return { isError: true, message: JSON.stringify(err) };
    }
  }

  public stop() {
    this.syncUI({
      isRunning: false,
      isThinking: false,
      targetId: null,
    });
  }
  public processEvent(event: BGRequest): BGResponse {
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
      this.runGameLoop(event.text);
      return { isOk: true, message: "Started" };
    }

    return { isOk: false, message: `Unknown event type ${event.type}` };
  }

  async fakeCallModel(
    systemPrompt: string,
    history: HistoryContentItem[],
  ): Promise<CallModelResult> {
    //commentable
    this.syncUI({ isThinking: true });
    await this.sleep(1000);
    this.syncUI({ isThinking: false });
    return {
      success: true,
      response: this.interactor.getTestScript(),
      sleepMs: 0,
    };
  }

  async callModel(
    systemPrompt: string,
    history: HistoryContentItem[],
  ): Promise<CallModelResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: history,
          generationConfig: { temperature: 0.1 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`API Error (${res.status}):`, errText);

        if (res.status === 429) {
          let sleepMs = 30000; // Default to 30 seconds if we can't parse it
          try {
            const errJson = JSON.parse(errText);
            const details = errJson.error?.details || [];
            const retryInfo = details.find((d: any) => d?.retryDelay);
            if (retryInfo && typeof retryInfo.retryDelay === "string") {
              const seconds = parseFloat(retryInfo.retryDelay);
              if (!isNaN(seconds)) {
                sleepMs = seconds * 1000 + 1000;
              }
            }
          } catch (e) {}

          return {
            success: false,
            error: "Rate limit exceeded (429)",
            sleepMs,
          };
        }

        return {
          success: false,
          error: `API Error (${res.status}): ${errText}`,
          sleepMs: 0,
        };
      }

      const data = await res.json();
      const parts = data.candidates[0].content.parts;
      const finalPart =
        parts.find((p: any) => !p.thought) || parts[parts.length - 1];

      return { success: true, response: finalPart.text, sleepMs: 0 };
    } catch (err: any) {
      console.error("Network error:", err);
      return {
        success: false,
        error: `Network error: ${err.message}`,
        sleepMs: 0,
      };
    }
  }

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getTabId() {
    return this.tabId;
  }

  async runGameLoop(userText: string) {
    if (this.uiState.isRunning) {
      return console.log("already running");
    }
    this.interactor.seedConvo(userText);
    this.syncUI({ isRunning: true, thought: userText });

    for (let step = 1; step <= 1000; step++) {
      if (!this.uiState.isRunning) {
        console.log("Agent execution stopped by user.");
        break;
      }

      const wait = this.usage.getWait();
      const seconds = Math.ceil(wait.ms / 1000);
      for (let i = 0; i < seconds; i++) {
        this.syncUI({
          thought: `Continuing in ${seconds - i}seconds... ${wait.reason}`,
        });
        await this.sleep(1000);
      }

      const { systemPrompt, history } = await this.interactor.buildPrompt();

      if (!this.uiState.isRunning) break;

      this.usage.updateUsage(`${systemPrompt}\n${history.join("\n")}`);
      const modelOut = await this.fakeCallModel(systemPrompt, history);
      // const modelOut = await this.callModel(systemPrompt, turnMessage);
      if (!this.uiState.isRunning) break;

      if (!modelOut.success) {
        if (modelOut.sleepMs > 0) {
          this.usage.blockForMs(modelOut.sleepMs);
          continue;
        } else {
          this.syncUI({ thought: `API Error: ${modelOut.error}` });
          await this.sleep(1000);
          continue;
        }
      }

      const raw = modelOut.response;
      await this.interactor.run(raw);
      if (!this.uiState.isRunning) break;
    }

    if (this.uiState.isRunning) {
      this.stop();
    }
  }
}
