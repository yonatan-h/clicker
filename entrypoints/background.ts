import { browser } from "wxt/browser";

type Action =
  | { action: "click"; id: string }
  | { action: "ask_user"; prompt: string }
  | { action: "done" };

const state = { pendingAskUser: null as string | null };

function snapshotFn(): string {
  const title = document.title || "";
  const url = window.location.href;

  const elements: string[] = [];
  let aiId = 1;
  for (const el of document.querySelectorAll(
    "button, a, [role='button'], input, select, textarea",
  )) {
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    const tag = el.tagName.toLowerCase();
    const text = (el as HTMLElement).innerText?.trim() || "";
    let label =
      text ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el as HTMLInputElement).placeholder ||
      (el.id ? `#${el.id}` : "");
    if (!label) {
      const img = el.querySelector("img");
      const dAttr = Array.from(el.attributes).find((a) =>
        a.name.startsWith("data-"),
      );
      const svg = el.querySelector("svg");
      const sAttr = svg
        ? Array.from(svg.attributes).find((a) => a.name.startsWith("data-"))
        : null;
      label =
        img?.alt ||
        (dAttr ? `${dAttr.name}="${dAttr.value}"` : "") ||
        (sAttr ? `svg[${sAttr.name}="${sAttr.value}"]` : "") ||
        (svg ? "(svg-icon)" : "(unlabeled)");
    }
    const val =
      tag === "input" || tag === "textarea" || tag === "select"
        ? ` value="${(el as HTMLInputElement).value || ""}"`
        : tag === "a"
          ? ` href="${el.getAttribute("href") || ""}"`
          : "";
    el.setAttribute("data-ai-id", aiId.toString());
    elements.push(`[${aiId}] [${tag}] "${label}"${val}`);
    aiId++;
  }

  const textLines: string[] = [];
  for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p")) {
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") continue;
    const text = (el as HTMLElement).innerText?.trim() || "";
    if (!text) continue;
    let ctx = "";
    if (text.length < 10 && el.parentElement) {
      const pText = el.parentElement.innerText?.trim().replace(text, "").trim();
      if (pText) ctx = ` — ${pText.slice(0, 50)}`;
    }
    textLines.push(`[${el.tagName.toLowerCase()}] "${text}"${ctx}`);
  }

  let out = `Page: ${title}\n\nURL: ${url}`;
  if (elements.length) out += `\n\nElements:\n${elements.join("\n")}`;
  if (textLines.length) out += `\n\nText:\n${textLines.join("\n")}`;
  return out;
}

async function clickElement(tabId: number, id: string): Promise<string> {
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (aiId: string) => {
      const e = document.querySelector(`[data-ai-id="${aiId}"]`) as HTMLElement;
      if (e) {
        e.click();
        return `clicked element ${aiId}`;
      }
      return `error: element ${aiId} not found`;
    },
    args: [id],
  });
  return result as string;
}

async function sendToChatGPT(tabId: number, prompt: string): Promise<void> {
  await browser.scripting.executeScript({
    target: { tabId },
    func: (txt: string) => {
      const el = document.querySelector("#prompt-textarea") as HTMLElement;
      if (!el) return;
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", txt);
      el.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData: dt }),
      );
      setTimeout(() => {
        (
          document.querySelector('[data-testid="send-button"]') as HTMLElement
        )?.click();
      }, 500);
    },
    args: [prompt],
  });
}

async function readChatGPTResponse(
  tabId: number,
  prevCount: number,
): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const [{ result }] = await browser.scripting.executeScript({
      target: { tabId },
      func: (count: number) => {
        const msgs = document.querySelectorAll(
          '[data-message-author-role="assistant"]',
        );
        if (
          msgs.length <= count ||
          document.querySelector('[data-testid="stop-button"]')
        )
          return null;
        return (msgs[msgs.length - 1] as HTMLElement).innerText?.trim() || null;
      },
      args: [prevCount],
    });
    if (result) return result as string;
  }
  return null;
}

const SYSTEM_PROMPT = `You are a browser automation agent. Respond with ONLY a single JSON action.
Actions:
  { "action": "click", "id": "1" }
  { "action": "ask_user", "prompt": "Message to show the user" }
  { "action": "done" }
Rules: ONLY valid JSON, no markdown. Use ask_user for passwords. done when finished.
Task: Log in to the application.`;

function parseAction(response: string): Action | null {
  try {
    const m = response.match(/\{[\s\S]*?\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

async function runAgentLoop() {
  const [local] = await browser.tabs.query({
    url: "http://localhost:7092/*",
  });
  const [chat] = await browser.tabs.query({ url: "*://chatgpt.com/*" });
  if (!local?.id || !chat?.id) return;

  for (let i = 0; i < 15; i++) {
    await browser.tabs.update(local.id, { active: true });
    const [{ result: snap }] = await browser.scripting.executeScript({
      target: { tabId: local.id },
      func: snapshotFn,
    });
    const prompt = i === 0 ? `${SYSTEM_PROMPT}\n\n${snap}` : (snap as string);
    await browser.tabs.update(chat.id, { active: true });
    const [{ result: cnt }] = await browser.scripting.executeScript({
      target: { tabId: chat.id },
      func: () =>
        document.querySelectorAll('[data-message-author-role="assistant"]')
          .length,
    });
    await sendToChatGPT(chat.id, prompt);
    const resp = await readChatGPTResponse(chat.id, (cnt as number) || 0);
    if (!resp) break;

    const action = parseAction(resp);
    if (!action) continue;

    if (action.action === "click") {
      await browser.tabs.update(local.id, { active: true });
      await clickElement(local.id, action.id);
      await new Promise((r) => setTimeout(r, 1000));
    } else if (action.action === "ask_user") {
      await browser.tabs.update(local.id, { active: true });
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
      await browser.tabs.update(local.id, { active: true });
      return;
    }
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: any, _sender, sendResponse) => {
      if (message?.action === "START") runAgentLoop();
      if (message?.action === "GET_STATE")
        sendResponse({ pendingAskUser: state.pendingAskUser });
      return true;
    },
  );
});
