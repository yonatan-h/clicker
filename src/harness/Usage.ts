export interface UsageSettings {
  reqPerMin: number;
  tokenPerMin: number;
  reqPerDay: number;
}

export class Usage {
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

  blockForMs(milliSeconds: number, reason:string) {
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
