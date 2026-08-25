import { takeSnapshot } from "@/src/snapshot/snapshot";
import { browser } from "wxt/browser";
import {
  type BGRequest,
  type BGResponse,
  type SnapshotResult,
  type UIRequest,
  type UIResponse,
  sendToUI,
} from "../utils/shared";

type HistoryItem = { role: "harness" | "model"; parts: { text: string }[] };
type ToolCall =
  | { type: "click"; id: number; thought: string }
  | { type: "type"; id: number; text: string; thought: string }
  | { type: "navigate"; url: string; thought: string }
  | { type: "ask_user"; question: string }
  | { type: "done"; result: string };

type ToolCallResponse = { message: string; isError: boolean };

type RateLimitInfo = {
  reqPerMin: number;
  tokenPerMin: number;
  reqPerDay: number;
};

//todo: subclass for non gemma4 usecases
export class Agent {
  //todo: use xml tags to separate. background, instructions, tools
  private history: HistoryItem[] = [];
  private rateLimit: RateLimitInfo = {
    reqPerMin: 30,
    tokenPerMin: 16000,
    reqPerDay: 14400,
  }; //gemma4 limits
  private tokenLog: { timestamp: number; tokens: number }[] = [];

  private countTokens(text: string): number {
    return text.match(/[\w]+|[^\s\w]/g)?.length || 0;
  }

  private tabId: number;
  private apiKey: string;
  private goal: string;

  constructor(tabId: number, apiKey: string, goal: string) {
    this.tabId = tabId;
    this.apiKey = apiKey;
    this.goal = goal;
  }

  public stop() {
    sendToUI(this.tabId, { type: "UPDATE_THINKING", isThinking: false });
    sendToUI(this.tabId, { type: "SHOW_THOUGHT", text: "Stopped" });
    this._isStopped = true;
  }
  public processEvent(event: BGRequest): BGResponse {
    if (event.type === "STOP") {
      this.stop();
      return { isOk: true, message: "stopped" };
    }

    return { isOk: false, message: `Unknown event type ${event.type}` };
  }

  async callModel(
    systemPrompt: string,
    currentPrompt: string,
  ): Promise<string | null> {
    //commentable
    await this.sleep(10000);
    const dummyCall: ToolCall = {
      type: "click",
      thought: "clicking anywhere",
      id: -1,
    };
    return JSON.stringify(dummyCall);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const requestContents = [
      ...this.history,
      { role: "harness", parts: [{ text: currentPrompt }] },
    ];

    this.tokenLog.push({
      timestamp: Date.now(),
      tokens: this.getActivityInfo(systemPrompt, currentPrompt).payloadInfo
        .totalTokens,
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
        return null;
      }

      const data = await res.json();
      const parts = data.candidates[0].content.parts;
      const finalPart =
        parts.find((p: any) => !p.thought) || parts[parts.length - 1];

      return finalPart.text;
    } catch (err) {
      console.error("Network error:", err);
      return null;
    }
  }

  extractToolCall(snippet: string):
    | {
        success: true;
        toolCall: ToolCall;
      }
    | { success: false; error: string } {
    try {
      const parsed = JSON.parse(snippet);
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
      role: "harness",
      parts: [
        {
          text: `Previous Action Status: ${args.previousActionStatus}\nPage URL: ${args.pageUrl}\nPage Title: ${args.pageTitle}`,
        },
      ],
    });

    this.history.push({
      role: "model",
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
    const result = await takeSnapshot(this.tabId);
    return result;
  }
  private _isStopped = false;

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
      const icon = msg.role === "harness" ? "👤" : "🤖";
      const text = msg.parts.map((p) => p.text).join("\n");
      const words = text.split(/\s+/).filter(Boolean).length;
      sections.push(
        `${icon} [${i}] role="${msg.role}" (~${words} words)\n${text}`,
      );
      i++;
    }

    const currentWords = currentTurnMessage.split(/\s+/).filter(Boolean).length;
    sections.push(
      `👤 [${i}] role="harness" (~${currentWords} words)\n${currentTurnMessage}`,
    );

    console.log(sections.join("\n\n"));
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runGameLoop() {
    this._isStopped = false;
    let previousActionStatus = "None (first step)";

    for (let step = 1; step <= 30; step++) {
      if (this._isStopped) {
        console.log("Agent execution stopped by user.");
        break;
      }

      const snapResult = await this.getUISnapshot();
      if (this._isStopped) break;
      if (!snapResult.success) {
        previousActionStatus = `Snapshot Error: ${snapResult.error}`;
        await this.sleep(2000);
      }

      const { systemPrompt, turnMessage } = this.buildPrompt({
        pageTitle: snapResult?.pageTitle || "<unknown>",
        pageUrl: snapResult?.pageUrl || "<unknown>",
        previousActionStatus,
        snapshot: snapResult.snapshot || "Could not get snapshot",
      });

      const info = this.getActivityInfo(systemPrompt, turnMessage);
      if (
        info.rateLimitUsage.reqsThisMin >= this.rateLimit.reqPerMin ||
        info.rateLimitUsage.tokensThisMin + info.payloadInfo.totalTokens >=
          this.rateLimit.tokenPerMin
      ) {
        console.warn("[Rate Limit] Nearing limits. Sleeping 1s...");
        await this.sleep(1000);
        continue;
      }

      this.printActivity(systemPrompt, turnMessage);

      if (this._isStopped) break;
      sendToUI(this.tabId, { type: "SHOW_THOUGHT", text: "Thinking..." });
      sendToUI(this.tabId, { type: "UPDATE_THINKING", isThinking: true });
      const raw = await this.callModel(systemPrompt, turnMessage);
      sendToUI(this.tabId, { type: "UPDATE_THINKING", isThinking: false });
      if (this._isStopped) break;
      if (!raw) {
        previousActionStatus = "API Error: No response or network failure";
        await this.sleep(2000);
        continue;
      }

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
        await sendToUI(this.tabId, {
          type: "SHOW_THOUGHT",
          text: action.thought,
        });
      }

      if (action.type === "click") {
        await sendToUI(this.tabId, { type: "MOVE_CURSOR", id: action.id });
        await this.sleep(2000);
        uiRes = await sendToUI(this.tabId, {
          type: "DO_CLICK",
          id: action.id,
        });
      } else if (action.type === "type") {
        await sendToUI(this.tabId, { type: "MOVE_CURSOR", id: action.id });
        await this.sleep(2000);
        uiRes = await sendToUI(this.tabId, {
          type: "DO_TYPE",
          id: action.id,
          text: action.text,
        });
      } else if (action.type === "navigate") {
        uiRes = { message: "Navigate is not implemented", isError: true };
      } else if (action.type === "ask_user") {
        uiRes = { message: "Ask User is not implemented", isError: true };
      } else if (action.type === "done") {
        console.log("Agent finished task:", action.result);
        await sendToUI(this.tabId, {
          type: "SHOW_THOUGHT",
          text: action.result,
        });
        await sendToUI(this.tabId, {
          type: "UPDATE_THINKING",
          isThinking: false,
        });
        break;
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
      } else {
        previousActionStatus = uiRes.message;
      }

      if (this._isStopped) break;
      await this.sleep(2000);
    }
  }
}
