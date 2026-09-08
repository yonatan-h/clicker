import { takeSnapshot } from "@/src/snapshot/snapshot";
import { browser } from "wxt/browser";
import {
  type BGRequest,
  type BGResponse,
  type SnapshotResult,
  type AgentUIState,
  sendToUI,
} from "../utils/shared";
import { getGoal } from "../utils/storage";

type HistoryItem = { role: "USER" | "MODEL"; parts: { text: string }[] };
type ToolCall =
  | { type: "click"; id: number; thought: string }
  | { type: "type"; id: number; text: string; thought: string }
  | { type: "navigate"; url: string; thought: string }
  | { type: "ask_user"; question: string }
  | { type: "done"; result: string };

type CallModelResult =
  | { success: true; response: string; sleepMs: number }
  | { success: false; error: string; sleepMs: number };

type RateLimitInfo = {
  reqPerMin: number;
  tokenPerMin: number;
  reqPerDay: number;
};

//todo: subclass for non gemma4 usecases
export class Agent {
  //todo: use xml tags to separate. background, instructions, tools
  private history: HistoryItem[] = [];
  private state: AgentUIState["state"] = "not-started";
  private rateLimit: RateLimitInfo = {
    reqPerMin: 30,
    tokenPerMin: 16000,
    reqPerDay: 14400,
  }; //gemma4 limits
  private tokenLog: { timestamp: number; tokens: number }[] = [];

  private countTokens(text: string): number {
    return text.match(/[\w]+|[^\s\w]/g)?.length || 0;
  }

  public tabId: number | null = null;
  private apiKey: string;
  public goal: string = "";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    getGoal().then((goal) => {
      this.goal = goal || "";
      this.syncUI();
    });
  }

  public uiState: AgentUIState = {
    goal: "",
    targetId: null,
    state: "not-started",
    isThinking: false,
    thought: null,
  };

  public async syncUI(partial?: Partial<AgentUIState>) {
    if (this.tabId === null) return;
    if (partial) {
      this.uiState = {
        ...this.uiState,
        ...partial,
        state: this.state,
        goal: this.goal,
      };
    }
    await sendToUI(this.tabId, { type: "SYNC_STATE", state: this.uiState });
  }

  public stop(customThought?: string) {
    this.state = "finished";
    this.syncUI({
      state: "finished",
      isThinking: false,
      thought: customThought || "Stopped",
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
      if (this.state === "not-started") {
        this.goal = event.text;
        this.runGameLoop();
        return { isOk: true, message: "Started" };
      } else if (this.state === "finished") {
        this.history.push({ role: "USER", parts: [{ text: event.text }] });
        this.runGameLoop();
        return { isOk: true, message: "Started" };
      }
      return { isOk: false, message: "Cannot start while running" };
    }

    return { isOk: false, message: `Unknown event type ${event.type}` };
  }

  async fakeCallModel(
    systemPrompt: string,
    currentPrompt: string,
  ): Promise<CallModelResult> {
    //commentable
    await this.sleep(4000);
    const dummyCall: ToolCall = {
      type: "click",
      thought: "clicking anywhere",
      id: -1,
    };
    return { success: true, response: JSON.stringify(dummyCall), sleepMs: 0 };
  }

  async callModel(
    systemPrompt: string,
    currentPrompt: string,
  ): Promise<CallModelResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const requestContents = [
      ...this.history,
      { role: "USER", parts: [{ text: currentPrompt }] },
    ];

    const info = this.getActivityInfo(systemPrompt, currentPrompt);
    this.tokenLog.push({
      timestamp: Date.now(),
      tokens: info.payloadInfo.totalTokens,
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: requestContents,
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

  extractToolCall(snippet: string):
    | {
        success: true;
        toolCall: ToolCall;
      }
    | { success: false; error: string } {
    try {
      let cleanSnippet = snippet;
      const startIndex = snippet.indexOf("{");
      const endIndex = snippet.lastIndexOf("}");
      if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        cleanSnippet = snippet.substring(startIndex, endIndex + 1);
      }

      const parsed = JSON.parse(cleanSnippet);
      if (!parsed || typeof parsed !== "object" || !parsed.type) {
        return {
          success: false,
          error: "Invalid JSON or missing 'type' field",
        };
      }

      return { success: true, toolCall: parsed as ToolCall };
    } catch (err: any) {
      return { success: false, error: `Failed to parse JSON: ${err.message}` };
    }
  }
  storeHistoryItem(args: {
    pageTitle: string;
    pageUrl: string;
    previousActionStatus: string;
    modelResponse: ToolCall | string;
  }): void {
    this.history.push({
      role: "USER",
      parts: [
        {
          text: `Previous Action Status: ${args.previousActionStatus}\nPage URL: ${args.pageUrl}\nPage Title: ${args.pageTitle}`,
        },
      ],
    });

    this.history.push({
      role: "MODEL",
      parts: [
        {
          text:
            typeof args.modelResponse === "string"
              ? args.modelResponse
              : JSON.stringify(args.modelResponse),
        },
      ],
    });
  }

  async getUISnapshot(): Promise<SnapshotResult> {
    const result = await takeSnapshot(this.tabId!);
    return result;
  }

  buildPrompt(args: {
    pageTitle: string;
    pageUrl: string;
    previousActionStatus: string;
    snapshot: string;
  }): { systemPrompt: string; turnMessage: string } {
    const systemPrompt = `<instruction>
You are an autonomous web automation agent. Your job is to achieve the user's goal by interacting with the provided UI snapshot.

Rules:
1. Output ONLY valid JSON matching one of the tool schemas. Do not output markdown code blocks (like \`\`\`json). Just the raw JSON.
2. The "id" field in your actions must be a number from the snapshot tree. Never use CSS selectors or raw text for the id.
3. Do NOT return the "done" action until you have visually confirmed the result on the page. Your final "thought" must state concrete findings.
4. After typing into a search field or form, look for a submit button or wait to see if the page updates automatically.
5. If you need to see more detail inside a container, or if the snapshot is truncated, use the "view" action.
6. Keep your "thought" field strictly to 1 or 2 short, concise sentences.
</instruction>

<tools>
- Click: {"type": "click", "id": 3, "thought": "Brief explanation."}
- Type: {"type": "type", "id": 5, "text": "search query", "thought": "Brief explanation."}
- Navigate: {"type": "navigate", "url": "https://example.com", "thought": "Brief explanation."}
- Ask User: {"type": "ask_user", "question": "What do you want me to do next?"}
- Done: {"type": "done", "result": "Summary of what was achieved."}
</tools>

<goal>
${this.goal}
</goal>`;

    const turnMessage = `<context>
URL: ${args.pageUrl}
Title: ${args.pageTitle}
Previous Action Status: ${args.previousActionStatus}
</context>

<snapshot>
${args.snapshot}
</snapshot>

Respond ONLY with a JSON object matching one of the tools.`;

    return { systemPrompt, turnMessage };
  }

  getActivityInfo(systemPrompt: string, currentTurnMessage: string) {
    const now = Date.now();
    const oneMinAgo = now - 60000;
    const oneDayAgo = now - 86400000;

    // Prune old logs
    this.tokenLog = this.tokenLog.filter((log) => log.timestamp > oneDayAgo);

    let reqsThisMin = 0;
    let tokensThisMin = 0;
    let reqsThisDay = this.tokenLog.length;

    for (const log of this.tokenLog) {
      if (log.timestamp > oneMinAgo) {
        reqsThisMin++;
        tokensThisMin += log.tokens;
      }
    }

    const historyText = this.history
      .map((h) => h.parts.map((p) => p.text).join(" "))
      .join(" ");
    const totalText =
      systemPrompt + " " + historyText + " " + currentTurnMessage;
    const totalTokens = this.countTokens(totalText);

    return {
      rateLimitUsage: {
        reqsThisMin,
        tokensThisMin,
        reqsThisDay,
      },
      payloadInfo: {
        totalTokens,
        systemPrompt,
        history: this.history,
        currentTurnMessage,
      },
    };
  }

  printActivity(systemPrompt: string, currentTurnMessage: string) {
    const info = this.getActivityInfo(systemPrompt, currentTurnMessage);

    const divider = "─".repeat(60);
    const sections: string[] = [];

    sections.push(`${divider}\n🤖 AGENT ACTIVITY LOG\n${divider}`);
    sections.push(
      `[RATE LIMIT USAGE]\nReqs/Min:   ${info.rateLimitUsage.reqsThisMin} / ${this.rateLimit.reqPerMin}\nTokens/Min: ${info.rateLimitUsage.tokensThisMin} / ${this.rateLimit.tokenPerMin}\nReqs/Day:   ${info.rateLimitUsage.reqsThisDay} / ${this.rateLimit.reqPerDay}`,
    );

    sections.push(`[PAYLOAD]\nTotal Tokens: ~${info.payloadInfo.totalTokens}`);

    sections.push(
      `${divider}\n📋 systemInstruction\n${divider}\n${info.payloadInfo.systemPrompt}`,
    );

    sections.push(
      `${divider}\n📜 contents (${info.payloadInfo.history.length + 1} messages)\n${divider}`,
    );

    let i = 0;
    for (const msg of info.payloadInfo.history) {
      const icon = msg.role === "MODEL" ? "👤" : "🤖";
      const text = msg.parts.map((p) => p.text).join("\n");
      const words = text.split(/\s+/).filter(Boolean).length;
      sections.push(
        `${icon} [${i}] role="${msg.role}" (~${words} words)\n${text}`,
      );
      i++;
    }

    const currentWords = currentTurnMessage.split(/\s+/).filter(Boolean).length;
    sections.push(
      `👤 [${i}] role="USER" (~${currentWords} words)\n${currentTurnMessage}`,
    );

    console.log(sections.join("\n\n"));
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runGameLoop() {
    if (this.state === "running") {
      return console.log("already running");
    }

    this.state = "running";
    this.syncUI({ thought: `${this.goal}`, targetId: null });
    await this.sleep(1000);

    let previousActionStatus = "None (first step)";

    for (let step = 1; step <= 30; step++) {
      if (this.state !== "running") {
        console.log("Agent execution stopped by user.");
        break;
      }
      const snapResult = await this.getUISnapshot();
      if (this.state !== "running") break;
      if (!snapResult.success) {
        previousActionStatus = `Snapshot Error: ${snapResult.error}`;
        await this.sleep(2000);
      }

      const { systemPrompt, turnMessage } = this.buildPrompt({
        pageTitle: snapResult.pageTitle,
        pageUrl: snapResult.pageUrl,
        previousActionStatus,
        snapshot: snapResult.snapshot,
      });

      const info = this.getActivityInfo(systemPrompt, turnMessage);
      if (
        info.rateLimitUsage.reqsThisMin >= this.rateLimit.reqPerMin ||
        info.rateLimitUsage.tokensThisMin + info.payloadInfo.totalTokens >=
          this.rateLimit.tokenPerMin
      ) {
        console.warn("[Rate Limit] Nearing limits. Sleeping 1s...", info.rateLimitUsage);
        this.syncUI({ thought: "Rate limited, waiting 1s", isThinking: true });
        await this.sleep(1000);
        this.syncUI({
          thought: "Finished waiting, resuming...",
          isThinking: false,
        });
        continue;
      }

      this.printActivity(systemPrompt, turnMessage);

      if (this.state !== "running") break;
      this.syncUI({ isThinking: true });
      const modelOut = await this.callModel(systemPrompt, turnMessage);
      // const modelOut = await this.fakeCallModel(systemPrompt, turnMessage);
      this.syncUI({ isThinking: false });
      if (this.state !== "running") break;

      if (!modelOut.success) {
        if (modelOut.sleepMs > 0) {
          this.syncUI({
            thought: `Rate limited. Waiting ${Math.ceil(modelOut.sleepMs / 1000)}s...`,
          });
          await this.sleep(modelOut.sleepMs);
          if (this.state !== "running") break;
          continue;
        } else {
          this.syncUI({ thought: `API Error: ${modelOut.error}` });
          previousActionStatus = `API Error: ${modelOut.error}`;
          await this.sleep(3000);
          continue;
        }
      }

      const raw = modelOut.response;

      const extractResult = this.extractToolCall(raw);
      if (!extractResult.success) {
        this.storeHistoryItem({
          pageTitle: snapResult.pageTitle,
          pageUrl: snapResult.pageUrl,
          previousActionStatus,
          modelResponse: raw,
        });
        previousActionStatus = `Parse Error: ${extractResult.error}`;
        await this.sleep(2000);
        continue;
      }

      const action = extractResult.toolCall;
      let uiRes: { message: string; isError: boolean };

      if ("thought" in action && action.thought) {
        this.syncUI({ thought: action.thought });
      }

      if (action.type === "click") {
        this.syncUI({ targetId: action.id });
        await this.sleep(2000);
        uiRes = await sendToUI(this.tabId!, {
          type: "DO_CLICK",
          id: action.id,
          state: this.uiState,
        });
      } else if (action.type === "type") {
        this.syncUI({ targetId: action.id });
        await this.sleep(2000);
        uiRes = await sendToUI(this.tabId!, {
          type: "DO_TYPE",
          id: action.id,
          text: action.text,
          state: this.uiState,
        });
      } else if (action.type === "navigate") {
        this.syncUI({ targetId: null });
        try {
          await browser.tabs.update(this.tabId!, { url: action.url });
          uiRes = { message: `Navigated to ${action.url}`, isError: false };
          await this.sleep(4000); // Give the page time to load
        } catch (e: any) {
          uiRes = { message: `Navigation failed: ${e.message}`, isError: true };
        }
      } else if (action.type === "ask_user") {
        uiRes = { message: "asking user", isError: false };
        this.stop(action.question);
      } else if (action.type === "done") {
        uiRes = { message: "finished", isError: false };
        this.stop(action.result);
      } else {
        uiRes = { message: "Unknown action type", isError: true };
      }

      //store upto the model sending an action, but the action result is for the next iter
      this.storeHistoryItem({
        pageTitle: snapResult.pageTitle,
        pageUrl: snapResult.pageUrl,
        previousActionStatus,
        modelResponse: action,
      });

      if (uiRes.isError) {
        previousActionStatus = `Error - ${uiRes.message}`;
        this.syncUI({ targetId: null, thought: previousActionStatus });
      } else {
        previousActionStatus = uiRes.message;
      }

      if (this.state !== "running") break;
    }
  }
}
