import { jsPython } from "jspython-interpreter";
import type { HistoryContentItem, Loop } from "./Loop";
import { Page } from "./tools/Page";

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
};

export class Interactor {
  private agent: Loop;
  private history: (UserItem | ModelItem)[] = [];

  constructor(agent: Loop) {
    this.agent = agent;
  }

  addToHistory(item: UserItem | ModelItem) {
    this.history.push(item);
    console.log("----", item);
  }

  seedConvo(userMessage: string) {
    this.addToHistory({
      isUser: true,
      text: userMessage,
      timeStamp: new Date().getTime(),
    });
  }

  getTestScript() {
    return `
      page._testPrint("hello test print")
      page.print_tree()
    `;
  }

  async run(script: string) {
    console.log("running script", script);
    this.agent.syncUI({ thought: `executing ${script}` });

    let prints: string[] = [];
    const print = (...args: any[]) => {
      console.log("%c" + args.join(" "), "color: lightblue");
      prints.push(`${args.join()}`);
    };

    const page = new Page(this.agent.getTabId(), print);


    try {
      await this.agent.sleep(1000);
      await jsPython().evaluate(script, {
        page,
        print,
      });
      this.agent.syncUI({ thought: "done executing" });
    } catch (e) {
      console.error("couldnot execute", e);
      this.agent.syncUI({ thought: `error when executing. ${e}` });
      print(e);
      await this.agent.sleep(1000);
    }

    const result = prints.join("\n");

    return { success: true, result };
  }

  async buildPrompt(): Promise<{
    systemPrompt: string;
    history: HistoryContentItem[];
  }> {
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

`;
    const history: HistoryContentItem[] = [];
    let item: HistoryContentItem | null = null;

    for (const cItem of this.history) {
      if (!item || (item.role === "USER" && !cItem.isUser)) {
        if (item) history.push(item);
        item = {
          role: "MODEL",
          parts: [{ text: (cItem as ModelItem).script }],
        };
      } else if (!item || (item.role === "MODEL" && cItem.isUser)) {
        if (item) history.push(item);
        item = { role: "USER", parts: [{ text: (cItem as UserItem).text }] };
      } else if (cItem.isUser) {
        item.parts.push({ text: cItem.text });
      } else if (!cItem.isUser) {
        item.parts.push({ text: cItem.script });
      }
    }

    if (item) history.push(item);

    return { systemPrompt, history };
  }
}
