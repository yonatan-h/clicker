import { jsPython } from "jspython-interpreter";
import type { HistoryContentItem, Loop } from "./Loop";
import { Page } from "./tools/Page";
import { Node } from "./tools/Page";
import { Sys } from "./tools/Sys";

//include script responses and user messages
export type UserItem = {
  isUser: true;
  text: string;
  timeStamp: number;
};

export type ModelItem = {
  isUser: false;
  timeStamp: number;
  script: string;
  scriptDescription: string;
};

export class Interactor {
  private loop: Loop;
  private history: (UserItem | ModelItem)[] = [];

  constructor(agent: Loop) {
    this.loop = agent;
  }

  addToHistory(item: UserItem | ModelItem) {
    this.history.push(item);
  }

  async seedConvo(userMessage: string) {
    const page = new Page(this.loop.getTabId(), () => {}, this.loop);
    const summary = await page._getSummary();
    this.addToHistory({
      isUser: true,
      text: `Page Summary:
${summary}

User message:
${userMessage}
`,
      timeStamp: new Date().getTime(),
    });
  }

  getTestScript() {
    return `
sys.simple_describe("Testing all available methods")

print("Getting body node...")
b = page.body()

print("Testing node properties...")
print("Tag: " + b.tag())
print("Text length: " + b.text().length)

print("Testing page print_tree...")
page.print_tree(b)

print("Testing navigate...")
page.navigate("https://example.com")

print("Testing click on body...")
b.click()

# Note: We won't test type() here because it explicitly throws an error 
# if the target isn't an input or textarea element!
# b.type("hello")

#sys.end("Finished testing all safe methods")
    `;
  }

  async run(script: string) {
    const print = (...args: any[]) => {
      console.log("%c" + args.join(" "), "color: lightblue");
      this.loop.syncUI({ thought: `printing - ${args}` });
      prints.push(`${args.join()}`);
    };

    const modelItem: ModelItem = {
      isUser: false,
      script,
      timeStamp: new Date().getTime(),
      scriptDescription: "<no description>",
    };
    this.addToHistory(modelItem);

    const page = new Page(this.loop.getTabId(), print, this.loop);
    const sys = new Sys(this.loop, print, (desc) => {
      modelItem.scriptDescription = desc;
      console.log("script description", desc);
    });

    console.log(script);
    this.loop.syncUI({ thought: `Running ${script}` });

    let prints: string[] = [];

    try {
      await this.loop.sleep(1000);
      await jsPython().evaluate(script, {
        page,
        print,
        sys,
        Node,
      });
      if (this.loop.uiState.isRunning) {
        this.loop.syncUI({ thought: "done executing" });
      }
    } catch (e) {
      console.error("couldnot execute", e);
      this.loop.syncUI({ thought: `error when executing. ${e}` });
      print(e);
      await this.loop.sleep(1000);
    }

    const result = prints.join("\n");

    const summary = await page._getSummary();
    this.addToHistory({
      isUser: true,
      text: `Script result:
${result}

Summary:
${summary}
`,
      timeStamp: new Date().getTime(),
    });

    return { success: true, result };
  }

  async buildPrompt(): Promise<{
    systemPrompt: string;
    history: HistoryContentItem[];
  }> {
    const systemPrompt = `You are a browser agent. You output simple python scripts to interact with the browser.
Don't use imports, function definitions, new classes. Simple if else, loops, etc are okay.
Use print statements to output debug info, or as comments for your thought process.
CRITICAL: Do NOT use f-strings (f"...")! The execution environment does not support them. Use standard string concatenation (+).

STRICT API LIMITATIONS:
1. You are RESTRICTED to ONLY the methods explicitly listed in 'Available objects' below.
2. Don't hallucinate or invent methods if they are not listed.
3. If a task requires an action you cannot perform with the available objects, fail gracefully by calling sys.end('<add your reason>').

Look at the conversation history to understand what has been done so far and what to do next.
Output ONLY a valid python script. No markdown, no explanation, just the script. Thanks.

Available objects:
${Page.describe()}
${Node.describe()}
${Sys.describe()}
`;
    const history: HistoryContentItem[] = [];
    let item: HistoryContentItem | null = null;

    const modelItems = this.history.filter((h) => !h.isUser);
    const userItems = this.history.filter((h) => h.isUser);

    for (const cItem of this.history) {
      const isLast =
        cItem === modelItems[modelItems.length - 1] ||
        cItem === userItems[userItems.length - 1];

      let text =
        "Time: " +
        new Date(cItem.timeStamp).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        }) +
        "\n";
      if (cItem.isUser) {
        text += cItem.text;
      } else {
        if (isLast) {
          text += `${cItem.script}`;
        } else {
          text += cItem.scriptDescription;
        }
      }

      if (!item) {
        if (cItem.isUser) {
          item = { role: "user", parts: [{ text }] };
        } else {
          item = { role: "model", parts: [{ text }] };
        }
      } else if (item.role === "user" && !cItem.isUser) {
        history.push(item);
        item = { role: "model", parts: [{ text }] };
      } else if (item.role === "model" && cItem.isUser) {
        history.push(item);
        item = { role: "user", parts: [{ text }] };
      } else if (cItem.isUser) {
        item.parts.push({ text });
      } else if (!cItem.isUser) {
        item.parts.push({ text });
      }
    }

    if (item) history.push(item);

    console.log("%c--- PROMPT ---", "color: gray; font-weight: bold;");
    console.log("%cSystem Prompt:\n" + systemPrompt, "color: lightgreen;");
    console.log("%cHistory:", "color: gray; font-weight: bold;");

    history.forEach((h, index) => {
      const isUser = h.role === "user";
      // Blue for user, Purple for model
      const color = isUser
        ? "color: #3b82f6; font-weight: bold;"
        : "color: #a855f7; font-weight: bold;";
      const prefix = `[${h.role.toUpperCase()} - Turn ${index + 1}]`;
      const text = h.parts.map((p) => p.text).join("\n");

      console.log(`%c${prefix}`, color);
      console.log(`%c${text}`, "color: lightgreen");
    });
    console.log("%c--------------", "color: gray; font-weight: bold;");
    return { systemPrompt, history };
  }
}
