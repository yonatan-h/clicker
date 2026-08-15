import { browser } from "wxt/browser";

const MODEL = "gemma-4-26b-a4b-it";

type Action = {
  thought?: string;
} & (
  | { action: "click"; id: string }
  | { action: "type"; id: string; text: string; pressEnter?: boolean }
  | { action: "ask_user"; prompt: string }
  | { action: "done" }
);

const state = { pendingAskUser: null as string | null };

const SYSTEM_PROMPT = `You are an autonomous browser agent. Output ONLY a valid JSON action matching one of these formats:
- To click: {"thought": "Short explanation", "action": "click", "id": "<id>"}
- To type into an input/textarea: {"thought": "Short explanation", "action": "type", "id": "<id>", "text": "value", "pressEnter": true}
- If you need credentials/input: {"thought": "Short explanation", "action": "ask_user", "prompt": "<message>"}
- When the goal is fully accomplished: {"thought": "Concrete summary of final findings/results", "action": "done"}

Universal Operating Rules:
1. ONLY valid JSON. Keep "thought" under 20 words.
2. Interaction Flow: When using tools, forms, or calculators:
   - Fill in necessary input fields step-by-step.
   - Click the action/submit button (e.g. Calculate, Run, Submit, Search).
   - Inspect the resulting output/data on the page before concluding.
3. Verified Completion: Do NOT return "done" prematurely. You must see the actual final result or answer rendered on the webpage.
4. Final Report: When calling "done", your "thought" MUST state the concrete findings, values, or answers discovered.

Task: i heard there is a tax calculator for alabama. can you find it in this website. make sure it works by trying it out. tell me at the end if it works as you expected.`;

function snapshotFn(): string {
  const elements: string[] = [];
  const seen = new Set<string>();
  let aiId = 1;

  for (const el of document.querySelectorAll(
    "button, a, [role='button'], input, select, textarea",
  )) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0")
      continue;

    const tag = el.tagName.toLowerCase();
    const raw =
      (el as HTMLElement).innerText?.trim() ||
      el.getAttribute("aria-label") ||
      (el as HTMLInputElement).placeholder ||
      el.id ||
      "";
    const label = raw.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!label && tag !== "input") continue;

    const val =
      tag === "input" || tag === "textarea"
        ? ` val="${((el as HTMLInputElement).value || "").slice(0, 30)}"`
        : "";
    el.setAttribute("data-ai-id", aiId.toString());
    elements.push(`[${aiId}] [${tag}] "${label || "(input)"}"${val}`);
    if (label) seen.add(label.toLowerCase());
    aiId++;
  }

  const textLines: string[] = [];
  for (const el of document.querySelectorAll("h1, h2, h3, h4, p")) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const text =
      (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim() || "";
    if (text.length < 3) continue;
    const truncated = text.slice(0, 80);
    if (seen.has(truncated.toLowerCase())) continue;
    textLines.push(`[${el.tagName.toLowerCase()}] "${truncated}"`);
    seen.add(truncated.toLowerCase());
  }

  return `Page: ${document.title}\nURL: ${window.location.href}\n\nElements:\n${elements.join("\n")}\n\nText:\n${textLines.join("\n")}`;
}

async function executeAction(
  tabId: number,
  act: Action,
): Promise<{ success: boolean; label: string }> {
  if (act.action !== "click" && act.action !== "type") {
    return { success: true, label: "" };
  }

  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (actionData: any) => {
      const e = document.querySelector(
        `[data-ai-id="${actionData.id}"]`,
      ) as HTMLElement;
      if (!e) return { success: false, label: "" };

      const tag = e.tagName.toLowerCase();
      const rawText =
        e.innerText?.trim() ||
        (e as HTMLInputElement).placeholder ||
        e.getAttribute("aria-label") ||
        e.id ||
        "";
      const label = `[${tag}] "${rawText.slice(0, 35)}"`;

      e.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });

      // Create or update cursor
      let cursor = document.getElementById("see-browse-cursor");
      if (!cursor) {
        cursor = document.createElement("div");
        cursor.id = "see-browse-cursor";
        cursor.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;display:flex;align-items:flex-start;gap:8px;transition:left 0.5s cubic-bezier(0.2,0.9,0.3,1),top 0.5s cubic-bezier(0.2,0.9,0.3,1);left:50vw;top:50vh;`;
        cursor.innerHTML = `
          <div id="see-browse-pointer" style="width:28px;height:28px;filter:drop-shadow(0 4px 10px rgba(0,0,0,0.4));transition:transform 0.18s ease;">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5.5 3.5L18.5 11.5L12 13.5L9.5 19.5L5.5 3.5Z" fill="#3b82f6" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>
          </div>
          <div id="see-browse-tooltip" style="background:rgba(15,23,42,0.94);backdrop-filter:blur(10px);color:#f8fafc;padding:8px 12px;border-radius:8px;font-family:sans-serif;font-size:13px;line-height:1.4;max-width:320px;box-shadow:0 10px 25px rgba(0,0,0,0.4);border-left:3px solid #3b82f6;"></div>
        `;
        document.body.appendChild(cursor);
      }

      // Tooltip content
      const tooltip = cursor.querySelector(
        "#see-browse-tooltip",
      ) as HTMLElement;
      let msg = `<div style="font-weight:500;">💭 ${actionData.thought || label}</div>`;
      if (actionData.action === "type") {
        msg += `<div style="color:#60a5fa;font-size:12px;margin-top:4px;">⌨️ Typing: "<strong>${actionData.text}</strong>"${actionData.pressEnter ? " + ↵" : ""}</div>`;
      }
      tooltip.innerHTML = msg;

      // Position cursor
      const rect = e.getBoundingClientRect();
      cursor.style.left = `${rect.left + (actionData.action === "type" ? 8 : rect.width / 2)}px`;
      cursor.style.top = `${rect.top + rect.height / 2}px`;

      // Highlight target element
      const prevOutline = e.style.outline;
      e.style.outline = "2px solid #3b82f6";
      setTimeout(() => {
        e.style.outline = prevOutline;
      }, 1000);

      // Perform action
      if (actionData.action === "click") {
        const pointer = cursor.querySelector(
          "#see-browse-pointer",
        ) as HTMLElement;
        setTimeout(() => {
          if (pointer) pointer.style.transform = "scale(0.8) rotate(-10deg)";
          setTimeout(() => {
            if (pointer) pointer.style.transform = "scale(1)";
            e.click();
          }, 150);
        }, 450);
      } else if (actionData.action === "type") {
        const input = e as HTMLInputElement;
        input.focus();
        input.value = actionData.text || "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (actionData.pressEnter) {
          input.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            }),
          );
          if (input.form)
            input.form.requestSubmit
              ? input.form.requestSubmit()
              : input.form.submit();
        }
      }

      return { success: true, label };
    },
    args: [act],
  });

  return result as { success: boolean; label: string };
}

async function callGemini(
  apiKey: string,
  prompt: string,
): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              thought: { type: "STRING" },
              action: {
                type: "STRING",
                enum: ["click", "type", "ask_user", "done"],
              },
              id: { type: "STRING" },
              text: { type: "STRING" },
              pressEnter: { type: "BOOLEAN" },
              prompt: { type: "STRING" },
            },
            required: ["action"],
          },
          temperature: 0.1,
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[${MODEL}] API Error (${res.status}):`, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error(`[${MODEL}] Network error:`, err);
    return null;
  }
}

function parseAction(response: string): Action | null {
  try {
    const m = response.trim().match(/\{[\s\S]*?\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (parsed?.action) return parsed;
    }
  } catch {}

  const typeMatch = response.match(
    /type\s+["']?([^"']+)["']?\s+(?:into|in)\s+(?:element\s+)?\[?(\d+)\]?/i,
  );
  if (typeMatch && typeMatch[1] && typeMatch[2]) {
    return {
      thought: response.slice(0, 80),
      action: "type",
      id: typeMatch[2],
      text: typeMatch[1],
      pressEnter: true,
    };
  }

  const clickMatch = response.match(
    /click(?:\s+on)?\s+(?:element\s+)?\[?(\d+)\]?/i,
  );
  if (clickMatch && clickMatch[1]) {
    return {
      thought: response.slice(0, 80),
      action: "click",
      id: clickMatch[1],
    };
  }

  if (
    /task\s+(?:is\s+)?(?:done|completed|finished)/i.test(response) ||
    /\b(done|finished)\b/i.test(response)
  ) {
    return { thought: response.slice(0, 80), action: "done" };
  }

  console.error("Failed to parse action:", response);
  return null;
}

async function runAgentLoop() {
  const { geminiApiKey } = (await browser.storage.local.get(
    "geminiApiKey",
  )) as { geminiApiKey?: string };
  if (!geminiApiKey) return console.error("Gemini API key not configured.");

  const [targetTab] = await browser.tabs.query({
    url: "*://*.toolsvillage.com/*",
  });
  if (!targetTab?.id)
    return console.warn("No open tab found for https://toolsvillage.com/*");

  console.log(
    `%c[Target Tab] ID: ${targetTab.id} | URL: ${targetTab.url}`,
    "color: #3b82f6; font-weight: bold;",
  );

  const actionLog: string[] = [];

  for (let i = 0; i < 15; i++) {
    const [{ result: snap }] = await browser.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: snapshotFn,
    });
    if (!snap) break;

    let prompt = "";
    if (actionLog.length > 0) {
      prompt += `Actions previously executed:\n${actionLog.map((a, idx) => `${idx + 1}. ${a}`).join("\n")}\n\n`;
    }
    prompt += `Current Page State:\n\n${snap}`;

    console.log(
      `\n================== [STEP ${i + 1} PROMPT / HISTORY] ==================\n` +
        prompt,
    );
    const resp = await callGemini(geminiApiKey, prompt);
    if (!resp) break;
    console.log(
      `\n================== [STEP ${i + 1} JSON RESPONSE] ==================\n` +
        resp,
    );

    const action = parseAction(resp);
    if (!action) continue;
    console.log(`\n[STEP ${i + 1} ACTION]`, action, "\n");

    if (action.action === "click" || action.action === "type") {
      const { label } = await executeAction(targetTab.id, action);
      const desc = label || `element [${action.id}]`;
      const thoughtText = action.thought
        ? ` (Reasoning: "${action.thought}")`
        : "";
      if (action.action === "click") {
        actionLog.push(`Clicked ${desc}${thoughtText}`);
      } else {
        actionLog.push(
          `Typed "${action.text}" into ${desc}${action.pressEnter ? " and submitted" : ""}${thoughtText}`,
        );
      }
      await new Promise((r) => setTimeout(r, 3000));
    } else if (action.action === "ask_user") {
      actionLog.push(`Asked user: "${action.prompt}"`);
      state.pendingAskUser = action.prompt;
      await new Promise<void>((resolve) => {
        const listener = (msg: any) => {
          if (msg?.action === "CONTINUE") {
            browser.runtime.onMessage.removeListener(listener);
            state.pendingAskUser = null;
            resolve();
          }
        };
        browser.runtime.onMessage.addListener(listener);
      });
    } else if (action.action === "done") {
      console.log("Task completed by agent.");
      return;
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: any, _sender, sendResponse) => {
      if (message?.action === "START") {
        runAgentLoop();
        sendResponse({ started: true });
        return true;
      }
      if (message?.action === "GET_STATE") {
        sendResponse({ pendingAskUser: state.pendingAskUser });
        return true;
      }
      if (message?.action === "CONTINUE") {
        sendResponse({ ok: true });
        return true;
      }
      return false;
    },
  );
});
