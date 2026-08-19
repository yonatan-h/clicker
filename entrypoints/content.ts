import { browser } from "wxt/browser";

type Message =
  | { type: "SHOW_THOUGHT"; text: string | null }
  | { type: "MOVE_CURSOR"; id: string }
  | { type: "DO_CLICK"; id: string }
  | { type: "DO_TYPE"; id: string; text: string };

type ActionResult = { message: string; isError: boolean };

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    function injectCursor() {
      let container = document.getElementById("sb-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "sb-container";
        container.style.cssText =
          "position:fixed;z-index:2147483647;pointer-events:none;" +
          "left:-999px;top:-999px;transition:left 0.4s ease,top 0.4s ease;";

        const dot = document.createElement("div");
        dot.id = "sb-cursor";
        dot.style.cssText =
          "width:18px;height:18px;border-radius:50%;background:#3b82f6;" +
          "box-shadow:0 0 0 3px rgba(59,130,246,0.3);position:absolute;" +
          "left:-9px;top:-9px;";

        const bubble = document.createElement("div");
        bubble.id = "sb-thought";
        bubble.style.cssText =
          "position:absolute;left:24px;top:-20px;background:rgba(0,0,0,0.85);" +
          "color:#fff;padding:6px 10px;border-radius:6px;font:13px/1.4 sans-serif;" +
          "width:300px;display:none;white-space:pre-wrap;";

        container.appendChild(dot);
        container.appendChild(bubble);
        document.body.appendChild(container);
      }
      return { container, bubble: document.getElementById("sb-thought")! };
    }

    const { container } = injectCursor();
    container.style.left = "100px";
    container.style.top = "100px";

    const findEl = (id: string): HTMLElement | ActionResult => {
      const el = document.querySelector(`[data-clickeru7i8p-id="${id}"]`) as HTMLElement;
      if (!el) return { message: `Element [${id}] not found`, isError: true };
      return el;
    };

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const message = msg as Message;

      if (message.type === "SHOW_THOUGHT") {
        const { bubble } = injectCursor();
        if (!message.text) {
          bubble.style.display = "none";
        } else {
          bubble.textContent = message.text;
          bubble.style.display = "block";
        }
        sendResponse({ message: "ok", isError: false } satisfies ActionResult);
      } else if (message.type === "MOVE_CURSOR") {
        const found = findEl(message.id);
        if ("isError" in found) {
          sendResponse(found);
        } else {
          const { container } = injectCursor();
          const rect = found.getBoundingClientRect();
          container.style.left = `${rect.left + rect.width / 2}px`;
          container.style.top = `${rect.top + rect.height / 2}px`;

          const prev = found.style.outline;
          found.style.outline = "2px solid #3b82f6";
          setTimeout(() => (found.style.outline = prev), 2000);
          sendResponse({
            message: "ok",
            isError: false,
          } satisfies ActionResult);
        }
      } else if (message.type === "DO_CLICK") {
        const found = findEl(message.id);
        if ("isError" in found) {
          sendResponse(found);
        } else {
          found.click();
          const label = found.innerText?.trim().slice(0, 35) || found.tagName;
          sendResponse({
            message: `Clicked "${label}"`,
            isError: false,
          } satisfies ActionResult);
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
          sendResponse({
            message: `Typed "${message.text}" into "${label}"`,
            isError: false,
          } satisfies ActionResult);
        }
      }
      return true;
    });
  },
});
