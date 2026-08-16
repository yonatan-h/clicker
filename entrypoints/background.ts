import { browser } from "wxt/browser";

type Action =
  | { thought: string; action: "click"; id: string }
  | { thought: string; action: "type"; id: string; text: string }
  | { thought: string; action: "done" };

type ActionResult = { message: string; isError: boolean };

const SYSTEM_PROMPT =
  "" +
  `You are a browser agent. You receive a page snapshot and output a JSON action.

Actions:
- Click: {"thought": "...", "action": "click", "id": "3"}
- Type:  {"thought": "...", "action": "type", "id": "3", "text": "hello"}
- Done:  {"thought": "summary of what you found", "action": "done"}

Rules:
1. Output ONLY valid JSON. The "thought" field is max 3 sentences.
2. The "id" is always a number from the snapshot tree (e.g. "3", "12"). Never use selectors or text.
3. Do NOT return "done" until you see the actual result on the page. Your final "thought" must state concrete findings.
4. After typing into a search/form, look for a submit button. If none exists, the results may have updated automatically.

goal: find and test the tax calculator. check if it works as expected.
`;

const content = {
  async moveTo(tabId: number, id: string, ms: number = 2000) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "MOVE_CURSOR", id });
    } catch {}
    await new Promise((r) => setTimeout(r, ms));
  },
  async showThought(tabId: number, text: string | null) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "SHOW_THOUGHT", text });
    } catch {}
  },
  async doClick(tabId: number, id: string): Promise<ActionResult> {
    try {
      const result = await browser.tabs.sendMessage(tabId, {
        type: "DO_CLICK",
        id,
      });
      return (
        (result as ActionResult) || { message: "No response", isError: true }
      );
    } catch {
      return { message: "Failed to communicate with page", isError: true };
    }
  },
  async doType(tabId: number, id: string, text: string): Promise<ActionResult> {
    try {
      const result = await browser.tabs.sendMessage(tabId, {
        type: "DO_TYPE",
        id,
        text,
      });
      return (
        (result as ActionResult) || { message: "No response", isError: true }
      );
    } catch {
      return { message: "Failed to communicate with page", isError: true };
    }
  },
};

import { cdpSnapshot } from "../utils/snapshot";

async function callGemini(
  apiKey: string,
  history: { role: string; parts: { text: string }[] }[],
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: history,
        generationConfig: { temperature: 0.1 },
      }),
    });
    if (!res.ok) {
      console.warn(`API Error (${res.status}):`, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.error("Network error:", err);
    return null;
  }
}

async function runAgentLoop(tabId: number) {
  const { geminiApiKey } = (await browser.storage.local.get(
    "geminiApiKey",
  )) as {
    geminiApiKey?: string;
  };
  if (!geminiApiKey) return console.error("Gemini API key not configured.");

  const history: { role: string; parts: { text: string }[] }[] = [];

  for (let step = 1; step <= 15; step++) {
    console.log(`\n${step} ${"─".repeat(60)}`);

    const snap = await cdpSnapshot(tabId);
    if (!snap) {
      console.error("Snapshot failed");
      break;
    }

    const userMsg = `Current page:\n${snap}`;
    history.push({ role: "user", parts: [{ text: userMsg }] });
    console.log(
      "%c[Extension → Gemini]",
      "color:#60a5fa",
      userMsg,
    );

    const raw = await callGemini(geminiApiKey, history);
    if (!raw) break;
    console.log("%c[Gemini → Extension]", "color:#fff", raw);
    history.push({ role: "model", parts: [{ text: raw }] });

    let action: Action;
    try {
      action = JSON.parse(raw) as Action;
    } catch {
      console.error("Failed to parse JSON:", raw);
      continue;
    }

    console.log(`[Step ${step}] action=${action.action}`, action);

    let result: ActionResult;
    if (action.action === "click") {
      await content.showThought(tabId, action.thought);
      await content.moveTo(tabId, action.id);
      result = await content.doClick(tabId, action.id);
    } else if (action.action === "type") {
      await content.showThought(
        tabId,
        `${action.thought}\n⌨️ "${action.text}"`,
      );
      await content.moveTo(tabId, action.id);
      result = await content.doType(tabId, action.id, action.text);
    } else if (action.action === "done") {
      await content.showThought(tabId, action.thought);
      console.log("Agent finished:", action.thought);
      return;
    } else {
      console.warn("Unknown action:", action);
      continue;
    }

    console.log(`[Result]`, result);

    if (result.isError) {
      history.push({
        role: "user",
        parts: [{ text: `Error: ${result.message}` }],
      });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: any, _sender, sendResponse) => {
      if (message?.action === "START") {
        browser.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) => {
            if (tab?.id) {
              runAgentLoop(tab.id);
            } else {
              console.error("No active tab found");
            }
          });
        sendResponse({ started: true });
      } else if (message?.action === "SNAPSHOT") {
        browser.tabs
          .query({ active: true, currentWindow: true })
          .then(async ([tab]) => {
            if (tab?.id) {
              console.log("Fetching snapshot...");
              const snap = await cdpSnapshot(tab.id);
              console.log("=== MANUAL SNAPSHOT ===\n" + snap);
            }
          });
        sendResponse({ snapshotStarted: true });
      }
      return true;
    },
  );
});
