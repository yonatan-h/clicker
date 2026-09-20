import { GoogleGenAI } from "@google/genai";
import type { HistoryContentItem, Loop } from "./Loop";

interface UsageSettings {
  reqPerMin: number;
  tokenPerMin: number;
  reqPerDay: number;
}

type CallModelResult =
  | { success: true; response: string; sleepMs: number }
  | { success: false; error: string; sleepMs: number };


class Usage {
  private usageSettings: UsageSettings;
  private tokenLog: { timestamp: number; tokens: number }[] = [];
  private openTimeStamp = 0;
  private blockForMsReason = "";

  private countTokens(text: string): number {
    return text.match(/[\w]+|[^\s\w]/g)?.length || 0;
  }
  constructor(usageSettings: UsageSettings) {
    this.usageSettings = usageSettings;
  }

  updateUsage(sentToModel: string) {
    this.tokenLog.push({
      timestamp: new Date().getTime(),
      tokens: this.countTokens(sentToModel),
    });
  }

  blockForMs(milliSeconds: number, reason: string) {
    this.openTimeStamp = new Date().getTime() + milliSeconds;
    this.blockForMsReason = reason;
  }

  getWait(): { ms: number; reason: string } {
    const now = new Date().getTime();

    const oneDayMs = 24 * 60 * 60 * 1000;
    this.tokenLog = this.tokenLog.filter(
      (log) => now - log.timestamp < oneDayMs,
    );

    if (now < this.openTimeStamp) {
      return { ms: this.openTimeStamp - now, reason: this.blockForMsReason };
    }

    const oneMinMs = 60 * 1000;
    const logsInLastMin = this.tokenLog.filter(
      (log) => now - log.timestamp < oneMinMs,
    );

    if (logsInLastMin.length >= this.usageSettings.reqPerMin) {
      const oldestInMin = logsInLastMin[0]!;
      return {
        ms: oldestInMin.timestamp + oneMinMs - now,
        reason: "Rate limit: Requests per minute",
      };
    }

    if (this.tokenLog.length >= this.usageSettings.reqPerDay) {
      const oldestInDay = this.tokenLog[0]!;
      return {
        ms: oldestInDay.timestamp + oneDayMs - now,
        reason: "Rate limit: Requests per day",
      };
    }

    const tokensInLastMin = logsInLastMin.reduce(
      (sum, log) => sum + log.tokens,
      0,
    );
    if (tokensInLastMin >= this.usageSettings.tokenPerMin) {
      const oldestInMin = logsInLastMin[0]!;
      return {
        ms: oldestInMin.timestamp + oneMinMs - now,
        reason: "Rate limit: Tokens per minute",
      };
    }

    return { ms: 0, reason: "" };
  }
}

export class ModelUtils {
  geminiUsage = new Usage({
    reqPerMin: 1000,
    tokenPerMin: 1000000,
    reqPerDay: 1000000,
  });
  jevUsage = new Usage({
    reqPerMin: 1000,
    tokenPerMin: 1000000,
    reqPerDay: 1000000,
  });

  constructor(
    private geminiKey: string,
    private jevKey: string,
    private loop: Loop,
  ) {}

  async fakeCallModel(
    systemPrompt: string,
    history: HistoryContentItem[],
  ): Promise<CallModelResult> {
    //commentable
    this.loop.syncUI({ isThinking: true });
    await this.loop.sleep(1000);
    this.loop.syncUI({ isThinking: false });
    return {
      success: true,
      response: JSON.stringify(this.loop),
      sleepMs: 0,
    };
  }

  async callModel(
    systemPrompt: string,
    history: HistoryContentItem[],
  ): Promise<CallModelResult> {
    try {
      const ai = new GoogleGenAI({ apiKey: 'test' });
      const response = await ai.models.generateContent({
        model: "gemma-4-31b-it",
        contents: history,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0,
        },
      });

      let text = response.text || "";
      const codeBlockMatch = text.match(/```[a-z]*\n([\s\S]*?)\n```/i);
      if (codeBlockMatch) {
        text = codeBlockMatch[1] || "";
      }
      text = text.trim();

      return { success: true, response: text, sleepMs: 0 };
    } catch (err: any) {
      console.error("API Error:", err);
      if (err.status === 429 || err.message?.includes("429")) {
        return {
          success: false,
          error: "Rate limit exceeded (429)",
          sleepMs: 30000,
        };
      }
      return {
        success: false,
        error: `API Error: ${err.message}`,
        sleepMs: 0,
      };
    }
  }
}
