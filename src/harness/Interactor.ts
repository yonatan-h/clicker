import { jsPython } from "jspython-interpreter";
import type { HistoryContentItem, Loop } from "./Loop";
import { Page } from "./tools/Page";
import { Node } from "./tools/Page";
import { Sys } from "./tools/Sys";
import {
  choice,
  noul,
  TypeSafeClient,
  type ChoiceCriteria,
  type Questions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";
import {
  ThinkingLevel,
  Type,
  type GoogleGenAI,
  type Schema,
  type SchemaUnion,
} from "@google/genai";
import { listNodes, stringifyTree } from "./tools/tree";

//include script responses and user messages

export type UserItem = {
  isUser: true;
  pageStats: string;
  userText: string;
  timeStamp: number;
};

export type ModelItem = {
  isUser: false;
  timeStamp: number;
  script: string;
  scriptDesc: string;
};

export class Interactor {
  private loop: Loop;
  private history: (UserItem | ModelItem)[] = [];

  constructor(agent: Loop) {
    this.loop = agent;
  }

  addToHistory(
    item: (Omit<UserItem, "timeStamp"> | Omit<ModelItem, "timeStamp">) & {
      timeStamp?: number;
    },
  ) {
    this.history.push({
      ...item,
      timeStamp: item.timeStamp ?? new Date().getTime(),
    });
  }

  async seedConvo(userMessage: string) {
    const page = new Page(this.loop.getTabId(), () => {}, this.loop, this);
    this.addToHistory({
      isUser: true,
      pageStats: await page._getStats(),
      userText: userMessage,
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
      scriptDesc: "<no description>",
    };
    this.addToHistory(modelItem);

    const page = new Page(this.loop.getTabId(), print, this.loop, this);
    const sys = new Sys(this.loop, print, (desc) => {
      modelItem.scriptDesc = desc;
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

    this.addToHistory({
      isUser: true,
      pageStats: await page._getStats(),
      userText: result,
    });

    return { success: true, result };
  }

  async fnCallGemini<T>(
    gemini: GoogleGenAI,
    prompt: string,
    thought: string,
    schema: Schema,
    thinkingLevel: ThinkingLevel = ThinkingLevel.MINIMAL,
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const history = this.buildHistory();
    history.push({
      role: "user",
      parts: [{ text: prompt }],
    });
    console.log(
      "%c🤖 [fnCallGemini] Requesting Gemini...",
      "color: #a855f7; font-weight: bold;",
      JSON.stringify(prompt, null, 2),
      JSON.stringify(history, null, 2),
      JSON.stringify(thinkingLevel, null, 2),
    );
    try {
      this.loop.syncUI({
        thought,
        isThinking: true,
      });
      const response = await gemini.models.generateContent({
        model: "gemma-4-26b-a4b-it",
        contents: history,
        config: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
          thinkingConfig: {
            thinkingLevel,
          },
        },
      });

      if (!response.text) throw "No response";
      const data = JSON.parse(response.text) as T;

      console.log(
        "%c🤖 [fnCallGemini] Response:",
        "color: #a855f7; font-weight: bold;",
        JSON.stringify(response, null, 2),
      );

      return { success: true, result: data };
    } catch (e: any) {
      const message = `${e.message || String(e)}`;
      this.loop.syncUI({ thought: message, isThinking: false });
      return { success: false, error: message };
    }
  }

  async getConclusion(
    gemini: GoogleGenAI,
    pageSummary: string,
  ): Promise<{ success: boolean; conclusion: string; error?: string }> {
    const prompt = `Based on the conversation history and the page summary, the user's instruction or question has been completed or answered.
Please provide a clear and concise final conclusion or summary of what was accomplished, or the answer to the user's question.

Page Summary:
${pageSummary}`;

    const res = await this.fnCallGemini<{ conclusion: string }>(
      gemini,
      prompt,
      "Thinking about the final conclusion...",
      {
        type: Type.OBJECT,
        properties: {
          conclusion: {
            type: Type.STRING,
            description:
              "The final conclusion, answer, or summary for the user. Keep it simple and short as possible. ",
          },
        },
        required: ["conclusion"],
      },
    );

    if (
      res.success &&
      res.result &&
      typeof res.result.conclusion === "string"
    ) {
      return { success: true, conclusion: res.result.conclusion };
    }
    return {
      success: false,
      conclusion: "",
      error: res.error || "No conclusion generated",
    };
  }

  async getUrlToNavigateTo(
    gemini: GoogleGenAI,
    pageSummary: string,
  ): Promise<{ success: boolean; url: string; error?: string }> {
    const prompt = `Based on the conversation history and the page summary, we need to navigate to a different url.
Please provide the exact absolute url that the user would want to navigate to (starting with http:// or https://).

Page Summary:
${pageSummary}`;

    const res = await this.fnCallGemini<{ url: string }>(
      gemini,
      prompt,
      "Thinking about where to navigate...",
      {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description: "The exact absolute URL to navigate to.",
          },
        },
        required: ["url"],
      },
    );

    if (res.success && res.result && typeof res.result.url === "string") {
      return { success: true, url: res.result.url };
    }
    return { success: false, url: "", error: res.error || "No URL generated" };
  }

  async getInput(
    gemini: GoogleGenAI,
    pageSummary: string,
    nodeSummary: string,
  ): Promise<{ success: boolean; input: string; pressEnter: boolean; clearBeforeTyping: boolean; error?: string }> {
    const prompt = `Based on the conversation history and the page summary, we need to type text into the input field: ${nodeSummary}.
Please provide the exact string that the user would want to type into this field.

Page Summary:
${pageSummary}`;

    const res = await this.fnCallGemini<{
      text: string;
      pressEnter: boolean;
      clearBeforeTyping: boolean;
    }>(
      gemini,
      prompt,
      "Thinking about the input text...",
      {
        type: Type.OBJECT,
        properties: {
          text: {
            type: Type.STRING,
            description: "The exact text to type into the input field.",
          },
          pressEnter: {
            type: Type.BOOLEAN,
            description: "Whether to press enter after typing.",
          },
          clearBeforeTyping: {
            type: Type.BOOLEAN,
            description: "Whether to clear the input before typing.",
          },
        },
        required: ["text", "pressEnter", "clearBeforeTyping"],
      },
    );

    if (res.success && res.result && typeof res.result.text === "string") {
      return { success: true, input: res.result.text, pressEnter: res.result.pressEnter, clearBeforeTyping: res.result.clearBeforeTyping };
    }
    return {
      success: false,
      input: "",
      pressEnter: false,
      clearBeforeTyping: false,
      error: res.error || "No text generated",
    };
  }

  buildHistory(): HistoryContentItem[] {
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
        text += cItem.pageStats + "\n" + cItem.userText;
      } else {
        if (isLast) {
          text += `${cItem.script}`;
        } else {
          text += cItem.scriptDesc;
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

    return history;
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
    const history = this.buildHistory();

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

  async systemOne<const Q extends Questions>(
    jev: TypeSafeClient,
    request: SystemOneRequest<Q>,
  ) {
    console.log(
      "%c--- JEV.SYSTEMONE REQUEST ---",
      "color: gray; font-weight: bold;",
    );
    console.log("%cState:", "color: lightblue; font-weight: bold;");
    console.log(JSON.stringify(request.state, null, 2));
    console.log("%cQuestions:", "color: lightblue; font-weight: bold;");
    console.log(JSON.stringify(request.questions, null, 2));
    console.log(
      "%c-----------------------------",
      "color: gray; font-weight: bold;",
    );
    const res = await jev.systemOne(request);

    console.log(
      "%c--- JEV.SYSTEMONE RESPONSE ---",
      "color: gray; font-weight: bold;",
    );
    console.log("%cAnswers:", "color: lightblue; font-weight: bold;");
    console.log(JSON.stringify(res.answers, null, 2));
    console.log(
      "%c------------------------------",
      "color: gray; font-weight: bold;",
    );

    return res;
  }

  async gameLoop(jev: TypeSafeClient, gemini: GoogleGenAI) {
    // this.loop.setSlowMo();
    try {
      for (let i = 0; i < 100; i++) {
        if (!this.loop.uiState.isRunning) {
          this.loop.syncUI({ thought: "stopped by user" });
          break;
        }
        let prints: string[] = [];
        const print = async (...args: any[]) => {
          console.log("%c" + args.join(" "), "color: lightblue");
          await this.loop.syncUI({ thought: `${args}` });
          prints.push(`${args.join()}`);
        };
        const sleepPrint = async (ms: number, ...args: any[]) => {
          print(...args);
          await this.loop.sleep(ms);
        };

        const page = new Page(this.loop.getTabId(), print, this.loop, this);
        await page._awaitPage();
        const sys = new Sys(this.loop, print, (desc) => {});

        const choiceCriteria: ChoiceCriteria = {};
        const tree = await page._getTree();
        for (const node of listNodes(tree)) {
          if (node.isInteractable) {
            const realnode = new Node(node, page, this.loop, this);
            choiceCriteria[node.id.toString()] =
              `${realnode.naturalDescription()}`;
          }
        }

        const response = await this.systemOne(jev, {
          state: {
            history: this.history,
            tree: tree,
          },
          questions: {
            action: choice("What action should i perform", {
              click: "When node is a button or button like",
              type: "When node is an input, text area, or something similar",
              navigate: {
                description:
                  "When pursuing the task on this page is likely not fruitful.",
                exclusions: [
                  "Do not select this if there are still relevant clickable or typable elements on this page that could progress the task.",
                ],
              },
            }),
            id: choice(
              "If i should click or type, which id should i click or type on?",
              choiceCriteria,
            ),
            end: noul(
              "Does the user have their instruction finished, or question answered yet?",
            ),
          },
        });

        if (!this.loop.uiState.isRunning) {
          this.loop.syncUI({ thought: "stopped by user" });
          break;
        }

        const modelItem: ModelItem = {
          isUser: false,
          timeStamp: new Date().getTime(),
          scriptDesc: ``,
          script: ``,
        };

        if (response.answers.end.noul > 0.8) {
          this.addToHistory({
            ...modelItem,
            scriptDesc: "End loop",
            script: "",
          });
          const result = await this.getConclusion(
            gemini,
            await page._getStats(),
          );
          if (result.success) {
            sys.end(result.conclusion);
          } else {
            sys.end(
              `Finished, but failed to generate conclusion: ${result.error}`,
            );
          }
          return;
        }
        const node = await page.find_by_id(
          parseInt(response.answers.id.choice),
        );
        if (!node) {
          await sleepPrint(1000, "Node not found!");
          return;
        }

        //click
        if (response.answers.action.choice === "click") {
          this.addToHistory({
            ...modelItem,
            scriptDesc: "click " + node.naturalDescription(),
            script: ``,
          });
          await node.click();
        }

        //type
        else if (response.answers.action.choice === "type") {
          const result = await this.getInput(
            gemini,
            stringifyTree(await page._getTree(), 1, true),
            node.naturalDescription(),
          );

          if (!result.success) {
            await sleepPrint(1000, "Failed to get input", result.error);
            continue;
          }

          this.addToHistory({
            ...modelItem,
            scriptDesc:
              "type " + result.input + " to " + node.naturalDescription(),
            script: `
          `,
          });
          await node.type(result.input, result.pressEnter, result.clearBeforeTyping);
        }
        //navigate
        else if (response.answers.action.choice === "navigate") {
          const result = await this.getUrlToNavigateTo(
            gemini,
            await page._getStats(),
          );

          if (!result.success) {
            await sleepPrint(
              1000,
              "Failed to get url to navigate to",
              result.error,
            );
            continue;
          }

          this.addToHistory({
            ...modelItem,
            scriptDesc: "navigate " + result.url,
            script: ``,
          });
          await page.navigate(result.url);
        }
        //other action
        else {
          this.addToHistory({
            ...modelItem,
            scriptDesc: `${response.answers.action.choice}`,
            script: ``,
          });
          await sleepPrint(1000, "Action not found!");
          this.addToHistory({
            isUser: true,
            pageStats: await page._getStats(),
            userText: `Action ${response.answers.action.choice} not found`,
          });
        }
      }

      await this.loop.syncUI({ thought: "Stopped by user" });
    } catch (e) {
      this.loop.syncUI({ thought: `Unexpected error: ${e}` });
    }
  }
}
