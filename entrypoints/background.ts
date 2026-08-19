import { browser } from "wxt/browser";

type Action =
  | { thought: string; action: "click"; id: string }
  | { thought: string; action: "type"; id: string; text: string }
  | { thought: string; action: "view"; viewQuery: string }
  | { thought: string; action: "done" };

type ActionResult = { message: string; isError: boolean };

function buildSystemPrompt(goal: string) {
  return `You are a browser agent. You receive a page snapshot and output a JSON action.

Actions:
- Click: {"thought": "...", "action": "click", "id": "3"}
- Type:  {"thought": "...", "action": "type", "id": "3", "text": "hello"}
- View:  {"thought": "...", "action": "view", "viewQuery": "nav"}
- Done:  {"thought": "summary of what you found", "action": "done"}

Rules:
1. Output ONLY valid JSON. No json blocks, only the JSON itself. The "thought" field is max 2 sentences.
2. The "id" is always a number from the snapshot tree (e.g. "3", "12"). Never use selectors or text.
3. Do NOT return "done" until you see the actual result on the page. Your final "thought" must state concrete findings.
4. After typing into a search/form, look for a submit button. If none exists, the results may have updated automatically.
5. If the snapshot is truncated or you need to see more detail inside a container, use the "view" action with a CSS selector.

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

import { snapshot } from "../utils/snapshot";

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

function buildMessage(
  systemPrompt: string,
  history: { role: string; parts: { text: string }[] }[],
) {
  const divider = "─".repeat(60);
  const sections: string[] = [];

  // System instruction — exactly as sent in systemInstruction.parts[0].text
  sections.push(`${divider}\n📋 systemInstruction\n${divider}\n${systemPrompt}`);

  // Contents — exactly the history array sent in "contents"
  sections.push(`${divider}\n📜 contents (${history.length} messages)\n${divider}`);
  const messageSizes: { index: number; role: string; words: number }[] = [];
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    const icon = msg.role === "user" ? "👤" : "🤖";
    const text = msg.parts.map((p) => p.text).join("\n");
    const words = text.split(/\s+/).filter(Boolean).length;
    messageSizes.push({ index: i, role: msg.role, words });
    sections.push(`${icon} [${i}] role="${msg.role}" (~${words} words)\n${text}`);
  }

  // Generation config
  sections.push(`${divider}\n⚙️ generationConfig\n${divider}\n{ temperature: 0.1 }`);

  // --- Metadata ---
  const allText = `${systemPrompt} ${history.map((m) => m.parts.map((p) => p.text).join(" ")).join(" ")}`;
  const totalWords = allText.split(/\s+/).filter(Boolean).length;
  const totalChars = allText.length;
  const estTokens = Math.round(totalWords * 1.3);
  const systemWords = systemPrompt.split(/\s+/).filter(Boolean).length;
  const largest = messageSizes.reduce((a, b) => (a.words > b.words ? a : b), messageSizes[0]);
  const userTurns = history.filter((m) => m.role === "user").length;
  const modelTurns = history.filter((m) => m.role === "model").length;

  const meta = [
    `📊 CONTEXT SUMMARY`,
    `   Total: ~${totalWords} words / ~${totalChars} chars → ~${estTokens} tokens est.`,
    `   Turns: ${history.length} (${userTurns} user, ${modelTurns} model)`,
    `   System prompt: ~${systemWords} words (${((systemWords / totalWords) * 100).toFixed(1)}% of context)`,
    `   Largest message: [${largest.index}] ${largest.role} (~${largest.words} words)`,
  ].join("\n");

  return `${meta}\n\n${sections.join("\n\n")}`;
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

  let currentSelector = "body";
  let lastActionStatus = "None (first step)";

  for (let step = 1; step <= 15; step++) {
    await content.showThought(tabId, "Getting snapshot ...");
    const snap = await snapshot(tabId, currentSelector);
    if (!snap) {
      await content.showThought(tabId, "snapshot failed!");
      console.error("Snapshot failed");
      break;
    }

    const tab = await browser.tabs.get(tabId);
    const contextStr = `Page: ${tab.title}\nURL: ${tab.url}\nPrevious Action Status: ${lastActionStatus}`;
    
    // The massive string sent ONLY for the current turn
    const currentTurnMsg = `${contextStr}\n\n[SUMMARY]\n${snap.summary}\n\n[SNAPSHOT (Selector: ${currentSelector})]\n${snap.snapshot}`;
    
    // Create a temporary history array to send to Gemini
    const requestHistory = [...history, { role: "user", parts: [{ text: currentTurnMsg }] }];

    console.log(buildMessage(systemPrompt, requestHistory));

    await content.showThought(tabId, "Model thinking...");
    const raw = await callGemini(geminiApiKey, requestHistory, tabId, systemPrompt);
    if (!raw) break;

    let action: Action;
    try {
      action = JSON.parse(raw) as Action;
    } catch {
      await content.showThought(
        tabId,
        "Failed to understand model response when parsing",
      );
      console.error("Failed to parse JSON:", raw);
      
      // Update history and status for failure
      history.push({ role: "user", parts: [{ text: contextStr }] });
      history.push({ role: "model", parts: [{ text: raw }] });
      lastActionStatus = "Error: Failed to parse model JSON.";
      continue;
    }

    let result: ActionResult | null = null;
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
    } else if (action.action === "view") {
      await content.showThought(
        tabId,
        `${action.thought}\n🔍 Viewing: "${action.viewQuery}"`,
      );
      currentSelector = action.viewQuery;
      
      // Update history before skipping to next loop
      history.push({ role: "user", parts: [{ text: contextStr }] });
      history.push({ role: "model", parts: [{ text: raw }] });
      lastActionStatus = `Viewed selector "${action.viewQuery}"`;
      continue;
    } else if (action.action === "done") {
      await content.showThought(tabId, action.thought);
      return;
    } else {
      await content.showThought(
        tabId,
        `Failed to understand model response when parsing. Model action: ${action}`,
      );
      history.push({ role: "user", parts: [{ text: contextStr }] });
      history.push({ role: "model", parts: [{ text: raw }] });
      lastActionStatus = "Error: Unknown action type.";
      continue;
    }

    // After successful execution (click or type), update history and set next status
    history.push({ role: "user", parts: [{ text: contextStr }] });
    history.push({ role: "model", parts: [{ text: raw }] });

    if (result && result.isError) {
      lastActionStatus = `Error: ${result.message}`;
    } else {
      lastActionStatus = "Success";
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
              const snap = await snapshot(tab.id);
              console.log("=== MANUAL SNAPSHOT ===\n" + (snap ? `Summary:\n${snap.summary}\n\nSnapshot:\n${snap.snapshot}` : 'null'));
            }
          });
        sendResponse({ snapshotStarted: true });
      }
      return true;
    },
  );
});
