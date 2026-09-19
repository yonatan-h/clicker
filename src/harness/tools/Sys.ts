import { Loop } from "../Loop";

export class Sys {
  constructor(
    private loop: Loop,
    private print: Function,
    private onDescription: (description: string) => void,
  ) {}

  async simple_describe(description: string) {
    this.onDescription(description);
    this.loop.syncUI({ thought: `Script goal: ${description}` });
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
