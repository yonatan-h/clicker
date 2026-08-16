import { browser } from "wxt/browser";

type Message =
  | { type: "SHOW_THOUGHT"; text: string | null }
  | { type: "MOVE_CURSOR"; id: string }
  | { type: "DO_CLICK"; id: string }
  | { type: "DO_TYPE"; id: string; text: string };

type ActionResult = { message: string; isError: boolean };

export default defineContentScript({
  matches: ["*://*.toolsvillage.com/*", "*://localhost/*"],
  main() {
    function injectCursor() {
      if (document.getElementById("sb-cursor")) return;
      const dot = document.createElement("div");
      dot.id = "sb-cursor";
      dot.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;" +
        "width:18px;height:18px;border-radius:50%;background:#3b82f6;" +
        "box-shadow:0 0 0 3px rgba(59,130,246,0.3);left:-40px;top:-40px;" +
        "transition:left 0.4s ease,top 0.4s ease;";
      const bubble = document.createElement("div");
      bubble.id = "sb-thought";
      bubble.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;" +
        "background:rgba(0,0,0,0.85);color:#fff;padding:6px 10px;" +
        "border-radius:6px;font:13px/1.4 sans-serif;max-width:300px;" +
        "left:-999px;top:-999px;transition:left 0.4s ease,top 0.4s ease;";
      document.body.appendChild(dot);
      document.body.appendChild(bubble);
    }

    const findEl = (id: string): HTMLElement | ActionResult => {
      const el = document.querySelector(`[data-ai-id="${id}"]`) as HTMLElement;
      if (!el) return { message: `Element [${id}] not found`, isError: true };
      return el;
    };

    injectCursor();

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const message = msg as Message;

      if (message.type === "SHOW_THOUGHT") {
        injectCursor();
        const bubble = document.getElementById("sb-thought")!;
        const dot = document.getElementById("sb-cursor")!;
        if (!message.text) {
          bubble.style.left = "-999px";
        } else {
          bubble.textContent = message.text;
          const x = parseFloat(dot.style.left) || 0;
          const y = parseFloat(dot.style.top) || 0;
          bubble.style.left = `${x + 24}px`;
          bubble.style.top = `${y - 10}px`;
        }
        sendResponse({ message: "ok", isError: false } satisfies ActionResult);
      } else if (message.type === "MOVE_CURSOR") {
        injectCursor();
        const found = findEl(message.id);
        if ("isError" in found) {
          sendResponse(found);
        } else {
          const dot = document.getElementById("sb-cursor")!;
          const rect = found.getBoundingClientRect();
          dot.style.left = `${rect.left + rect.width / 2 - 9}px`;
          dot.style.top = `${rect.top + rect.height / 2 - 9}px`;
          const prev = found.style.outline;
          found.style.outline = "2px solid #3b82f6";
          setTimeout(() => (found.style.outline = prev), 2000);
          sendResponse({ message: "ok", isError: false } satisfies ActionResult);
        }
      } else if (message.type === "DO_CLICK") {
        const found = findEl(message.id);
        if ("isError" in found) {
          sendResponse(found);
        } else {
          found.click();
          const label = found.innerText?.trim().slice(0, 35) || found.tagName;
          sendResponse({ message: `Clicked "${label}"`, isError: false } satisfies ActionResult);
        }
      } else if (message.type === "DO_TYPE") {
        const found = findEl(message.id);
        if ("isError" in found) {
          sendResponse(found);
        } else {
          const input = found as HTMLInputElement;
          input.focus();
          input.value = message.text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          const label = input.placeholder || input.tagName;
          sendResponse({ message: `Typed "${message.text}" into "${label}"`, isError: false } satisfies ActionResult);
        }
      }
      return true;
    });
  },
});
