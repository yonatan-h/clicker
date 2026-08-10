import { browser } from "wxt/browser";

// --- Types ---

type Action =
  | { action: "click"; text: string }
  | { action: "fill"; text: string; value: string }
  | { action: "ask_user"; prompt: string }
  | { action: "done" };

interface LoopState {
  pendingAskUser: string | null;
}

const state: LoopState = { pendingAskUser: null };

// --- DOM Snapshot ---

function snapshotFn(): string {
  const TAGS = new Set([
    "INPUT",
    "BUTTON",
    "SELECT",
    "TEXTAREA",
    "A",
    "LABEL",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
  ]);

  const lines: string[] = [];

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      el.getAttribute("aria-hidden") !== "true"
    );
  }

  function walk(node: Element) {
    if (!isVisible(node)) return;

    if (TAGS.has(node.tagName)) {
      const type = node.tagName.toLowerCase();
      const rawText = (node as HTMLElement).innerText?.trim() ?? "";
      const text =
        rawText ||
        node.getAttribute("aria-label") ||
        node.getAttribute("title") ||
        "";
      const href = node.getAttribute("href");

      if (type === "input" || type === "textarea" || type === "select") {
        const inputEl = node as HTMLInputElement;
        const placeholder = inputEl.placeholder || "";
        const value = inputEl.value || "";
        const inputType = inputEl.type || "text";
        lines.push(
          `[${type}:${inputType}] placeholder="${placeholder}" value="${value}"`,
        );
      } else if (href) {
        lines.push(`[${type} href="${href}"] "${text}"`);
      } else {
        lines.push(`[${type}] "${text}"`);
      }
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(document.body);
  return lines.join("\n");
}

async function getPageSnapshot(tabId: number): Promise<string> {
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: snapshotFn,
  });
  return (result as string) || "(empty page)";
}

// --- Wait for element by text (5s max, 300ms poll) ---

async function waitForText(tabId: number, text: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const [{ result }] = await browser.scripting.executeScript({
      target: { tabId },
      func: (searchText: string) => {
        const all = document.querySelectorAll(
          "button, a, label, input, textarea, select, h1, h2, h3, h4, h5, h6",
        );
        for (const el of all) {
          const elText = (el as HTMLElement).innerText?.trim() ?? "";
          const placeholder = (el as HTMLInputElement).placeholder ?? "";
          if (
            elText.toLowerCase().includes(searchText.toLowerCase()) ||
            placeholder.toLowerCase().includes(searchText.toLowerCase())
          ) {
            return true;
          }
        }
        return false;
      },
      args: [text],
    });
    if (result) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// --- Action Executors ---

async function executeClick(tabId: number, text: string): Promise<string> {
  await browser.tabs.update(tabId, { active: true });
  const found = await waitForText(tabId, text);
  if (!found)
    return `error: could not find element with text "${text}" within 5 seconds`;

  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (searchText: string) => {
      const all = document.querySelectorAll(
        "button, a, label, [role='button'], input[type='submit']",
      );
      for (const el of all) {
        const elText = (el as HTMLElement).innerText?.trim() ?? "";
        if (elText.toLowerCase().includes(searchText.toLowerCase())) {
          (el as HTMLElement).click();
          return `clicked "${elText}"`;
        }
      }
      return "error: element found during wait but gone during click";
    },
    args: [text],
  });
  return result as string;
}

async function executeFill(
  tabId: number,
  text: string,
  value: string,
): Promise<string> {
  const found = await waitForText(tabId, text);
  if (!found) return `error: could not find field "${text}" within 5 seconds`;

  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: (searchText: string, fillValue: string) => {
      // Strategy 1: find a label with matching text, then find its associated input
      const labels = document.querySelectorAll("label");
      for (const label of labels) {
        const labelText = label.innerText?.trim() ?? "";
        if (labelText.toLowerCase().includes(searchText.toLowerCase())) {
          // Try "for" attribute
          const forAttr = label.getAttribute("for");
          let input: HTMLInputElement | null = null;
          if (forAttr) {
            input = document.getElementById(forAttr) as HTMLInputElement;
          }
          // Try finding input inside the label
          if (!input) {
            input = label.querySelector("input, textarea, select");
          }
          // Try finding input as next sibling or nearby
          if (!input) {
            const parent = label.closest(
              ".MuiFormControl-root, .MuiTextField-root, div",
            );
            if (parent) {
              input = parent.querySelector("input, textarea, select");
            }
          }
          if (input) {
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (nativeSetter) {
              nativeSetter.call(input, fillValue);
            } else {
              input.value = fillValue;
            }
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return `filled "${labelText}" with "${fillValue}"`;
          }
        }
      }

      // Strategy 2: find input by placeholder
      const inputs = document.querySelectorAll("input, textarea");
      for (const input of inputs) {
        const placeholder = (input as HTMLInputElement).placeholder ?? "";
        if (placeholder.toLowerCase().includes(searchText.toLowerCase())) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(input, fillValue);
          } else {
            (input as HTMLInputElement).value = fillValue;
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return `filled placeholder "${placeholder}" with "${fillValue}"`;
        }
      }

      return `error: could not find input for "${searchText}"`;
    },
    args: [text, value],
  });
  return result as string;
}

// --- ChatGPT Interface ---

async function sendToChatGPT(tabId: number, prompt: string): Promise<void> {
  await browser.tabs.update(tabId, { active: true });

  await browser.scripting.executeScript({
    target: { tabId },
    func: (text: string) => {
      const input = document.querySelector("#prompt-textarea") as HTMLElement;
      if (!input) return;
      input.focus();

      const data = new DataTransfer();
      data.setData("text/plain", text);
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
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

async function readChatGPTResponse(tabId: number): Promise<string | null> {
  // Wait for response to appear (poll until we see a new assistant message that looks done)
  const start = Date.now();
  while (Date.now() - start < 60000) {
    await new Promise((r) => setTimeout(r, 2000));

    const [{ result }] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => {
        const messages = document.querySelectorAll(
          '[data-message-author-role="assistant"]',
        );
        if (!messages.length) return null;
        const last = messages[messages.length - 1] as HTMLElement;
        const text = last.innerText?.trim() ?? "";

        // Check if response is still streaming (button exists)
        const stopButton = document.querySelector(
          '[data-testid="stop-button"]',
        );
        if (stopButton) return null; // still generating

        return text || null;
      },
    });

    if (result) return result as string;
  }

  return null; // timed out after 60s
}

// --- Main Agent Loop ---

const SYSTEM_PROMPT = `You are a browser automation agent. You interact with a web page by responding with a single JSON action per turn.

Available actions:
  { "action": "click", "text": "Button Text" }
  { "action": "fill", "text": "Label or Placeholder", "value": "text to type" }
  { "action": "ask_user", "prompt": "Message to show the user" }
  { "action": "done" }

Rules:
- Respond with ONLY a valid JSON object, no markdown, no explanation.
- You will receive the page state after each action.
- Use ask_user when you need the human to enter sensitive info like passwords.
- Use done when the task is complete or if you are stuck.

Your task: Log in to the application.`;

function parseAction(response: string): Action | null {
  try {
    // Try to extract JSON from the response (ChatGPT sometimes wraps in markdown)
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.action) return parsed as Action;
    return null;
  } catch {
    return null;
  }
}

async function runAgentLoop() {
  const MAX_ITERATIONS = 15;

  const localhostTabs = await browser.tabs.query({
    url: "http://localhost:7092/*",
  });
  const chatGptTabs = await browser.tabs.query({ url: "*://chatgpt.com/*" });

  if (localhostTabs.length === 0 || chatGptTabs.length === 0) {
    console.error(
      `Need at least 1 localhost tab (found ${localhostTabs.length}) and 1 ChatGPT tab (found ${chatGptTabs.length}).`,
    );
    return;
  }

  const targetTabId = localhostTabs[0].id!;
  const chatTabId = chatGptTabs[0].id!;
  const history: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`--- Agent loop iteration ${i + 1} ---`);

    // 1. Snapshot
    const snapshot = await getPageSnapshot(targetTabId);
    console.log("Page snapshot:\n" + snapshot);

    // 2. Build prompt
    let prompt: string;
    if (i === 0) {
      prompt = `${SYSTEM_PROMPT}\n\nCurrent page state:\n${snapshot}`;
    } else {
      prompt = `Action history:\n${history.join("\n")}\n\nCurrent page state:\n${snapshot}`;
    }

    // 3. Send to ChatGPT
    await sendToChatGPT(chatTabId, prompt);

    // 4. Read response
    const response = await readChatGPTResponse(chatTabId);
    if (!response) {
      console.error("ChatGPT did not respond in time.");
      break;
    }
    console.log("ChatGPT response:", response);

    // 5. Parse action
    const action = parseAction(response);
    if (!action) {
      console.error("Could not parse action from response:", response);
      history.push(`[error] could not parse action from: "${response}"`);
      continue;
    }
    console.log("Parsed action:", JSON.stringify(action));

    // 6. Execute action
    let result: string;

    switch (action.action) {
      case "click":
        result = await executeClick(targetTabId, action.text);
        // Wait a moment for potential navigation/re-render
        await new Promise((r) => setTimeout(r, 1000));
        break;

      case "fill":
        result = await executeFill(targetTabId, action.text, action.value);
        break;

      case "ask_user":
        state.pendingAskUser = action.prompt;
        console.log(`Waiting for user: ${action.prompt}`);
        await browser.tabs.update(targetTabId, { active: true });
        // Wait for user to click Continue in popup
        result = await new Promise<string>((resolve) => {
          const listener = (message: unknown) => {
            if (
              typeof message === "object" &&
              message !== null &&
              "action" in message &&
              (message as { action: string }).action === "CONTINUE"
            ) {
              browser.runtime.onMessage.removeListener(listener);
              state.pendingAskUser = null;
              resolve("user continued");
            }
          };
          browser.runtime.onMessage.addListener(listener);
        });
        break;

      case "done":
        console.log("Agent finished.");
        await browser.tabs.update(targetTabId, { active: true });
        return;

      default:
        result = `error: unknown action "${(action as Action).action}"`;
    }

    history.push(`[${action.action}] ${result!}`);
    console.log("Result:", result!);
  }

  console.log("Agent loop ended (max iterations reached).");
}

// --- Entry Point ---

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "action" in message
      ) {
        const msg = message as { action: string };

        if (msg.action === "START") {
          runAgentLoop();
        }

        if (msg.action === "GET_STATE") {
          sendResponse({ pendingAskUser: state.pendingAskUser });
        }
      }
      return true;
    },
  );
});
