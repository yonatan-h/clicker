import { Loop } from "../Loop";

export class Sys {
  constructor(
    private loop: Loop,
    private print: Function,
    private onDescription: (description: string) => void,
  ) {}

  async askUser(
    question: string,
    options: string[],
    includeOther: boolean,
  ): Promise<string> {
    const id = Date.now();
    await this.loop.syncUI({
      ask: {
        id,
        question,
        options,
        includeOther,
      },
    });

    const response = await this.loop.listen("ANSWER", id);
    if (response.type === "ANSWER") {
      await this.loop.syncUI({ ask: null, thought: `Answered: ${response.ans}` });
      return response.ans;
    }
    throw new Error("Invalid response type");
  }

  async simple_describe(description: string) {
    this.onDescription(description);
    await this.loop.syncUI({ thought: `Script goal: ${description}` });
  }
  async end(message: string) {
    await this.loop.syncUI({ thought: message });
    this.loop.stop();
  }

  static describe() {
    return `Sys: General purpose utilities.
  sys.simple_describe(description: string) - Describes the intent of the current script. MUST be called only once at the beginning of every script.
  sys.end(message: string) - Ends the current task and displays the given message.
`;
  }
}
