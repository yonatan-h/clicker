import { browser } from "wxt/browser";

type Action =
  | { thought: string; action: "click"; id: string }
  | { thought: string; action: "type"; id: string; text: string }
  | { thought: string; action: "done" };

type ActionResult = { message: string; isError: boolean };

function buildSystemPrompt(goal: string) {
  return `You are a browser agent. You receive a page snapshot and output a JSON action.

Actions:
- Click: {"thought": "...", "action": "click", "id": "3"}
- Type:  {"thought": "...", "action": "type", "id": "3", "text": "hello"}
- Done:  {"thought": "summary of what you found", "action": "done"}

Rules:
1. Output ONLY valid JSON. No json blocks, only the JSON itself. The "thought" field is max 2 sentences.
2. The "id" is always a number from the snapshot tree (e.g. "3", "12"). Never use selectors or text.
3. Do NOT return "done" until you see the actual result on the page. Your final "thought" must state concrete findings.
4. After typing into a search/form, look for a submit button. If none exists, the results may have updated automatically.

goal: ${goal}
`;
}

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

interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
        thought?: boolean;
      }[];
      role: string;
    };
  }[];
}

async function callGemini(
  apiKey: string,
  history: { role: string; parts: { text: string }[] }[],
  tabId: number,
  systemPrompt: string,
  retries = 3,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: history,
          generationConfig: { temperature: 0.1 },
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          let delaySeconds: number | null = null;
          try {
            const errJson = JSON.parse(errText);
            const retryInfo = errJson.error?.details?.find(
              (d: any) =>
                d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
            );
            if (
              retryInfo?.retryDelay &&
              typeof retryInfo.retryDelay === "string"
            ) {
              const match = retryInfo.retryDelay.match(/^([0-9.]+)s$/);
              if (match) {
                delaySeconds = parseFloat(match[1]);
              }
            }
          } catch (e) {}

          if (delaySeconds !== null) {
            await content.showThought(
              tabId,
              `Rate limit exceeded, trying again after ${delaySeconds} seconds`,
            );
            console.warn(
              `[Rate Limit] Exceeded quota. Sleeping for ${delaySeconds}s before retry ${attempt}/${retries}...`,
            );
            await new Promise((r) =>
              setTimeout(r, delaySeconds * 2 * 1000 + 500),
            );
            continue;
          }
        }

        await content.showThought(tabId, `Api error: ${errText}`);
        console.warn(`API Error (${res.status}):`, errText);
        return null;
      }

      const data: GeminiResponse = await res.json();

      const parts = data.candidates[0].content.parts;
      const finalPart =
        parts.find((p) => !p.thought) || parts[parts.length - 1];

      return finalPart.text;
    } catch (err) {
      console.error("Network error on attempt", attempt, ":", err);
      if (attempt === retries) return null;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function runAgentLoop(tabId: number, goal: string) {
  const { geminiApiKey } = (await browser.storage.local.get(
    "geminiApiKey",
  )) as {
    geminiApiKey?: string;
  };

  await content.showThought(tabId, "Starting ...");
  if (!geminiApiKey) {
    await content.showThought(tabId, "API key not configured.");
    return console.error("Gemini API key not configured.");
  }

  const history: { role: string; parts: { text: string }[] }[] = [];
  const systemPrompt = buildSystemPrompt(goal);

  for (let step = 1; step <= 15; step++) {
    console.log(`\n${step} ${"─".repeat(60)}`);

    await content.showThought(tabId, "Getting snapshot ...");
    const snap = await cdpSnapshot(tabId);
    if (!snap) {
      await content.showThought(tabId, "snapshot failed!");
      console.error("Snapshot failed");
      break;
    }

    const userMsg = `Current page:\n${snap}`;
    history.push({ role: "user", parts: [{ text: userMsg }] });
    console.log("%c[Extension → Gemini]", "color:#60a5fa", userMsg);

    await content.showThought(tabId, "Model thinking...");
    const raw = await callGemini(geminiApiKey, history, tabId, systemPrompt);
    if (!raw) break;
    console.log("%c[Gemini → Extension]", "color:#fff", raw);
    history.push({ role: "model", parts: [{ text: raw }] });

    let action: Action;
    try {
      action = JSON.parse(raw) as Action;
    } catch {
      await content.showThought(
        tabId,
        "Failed to understand model response when parsing",
      );
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
      await content.showThought(
        tabId,
        `Failed to understand model response when parsing. Model action: ${action}`,
      );
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
              runAgentLoop(tab.id, message.goal);
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
