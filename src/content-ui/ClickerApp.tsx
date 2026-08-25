import { browser } from "wxt/browser";
import { useState, useEffect } from "react";
import {
  ID_ATTR,
  type UIResponse,
  type UIRequest,
  sendToBg,
} from "@/src/utils/shared";
import Arrow from "./arrow/Arrow";

export default function ClickerApp() {
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 10, y: 10 });
  const [thinking, setThinking] = useState(false);
  const [thought, setThought] = useState<string | null>(null);

  const findEl = (id: number): HTMLElement | null => {
    const el = document.querySelector(`[${ID_ATTR}="${id}"]`);
    if (!(el instanceof HTMLElement)) return null;
    return el;
  };

  useEffect(() => {
    setPos({ x: 100, y: 100 });

    const listener = (
      _request: unknown,
      _sender: any,
      _sendResponse: Function,
    ) => {
      const send = (resp: UIResponse) => {
        _sendResponse(resp);
      };
      const req = _request as UIRequest;
      const elNotFound = (id: number) => ({
        message: `Element with id=${id} not found`,
        isError: true,
      });
      const ok = () => ({
        message: `Ok`,
        isError: false,
      });

      switch (req.type) {
        case "UPDATE_THINKING": {
          setThinking(req.isThinking);
          send(ok());
          break;
        }
        case "SHOW_THOUGHT": {
          setThought(req.text);
          send(ok());
          break;
        }

        case "MOVE_CURSOR": {
          const el = findEl(req.id);
          if (!el) return send(elNotFound(req.id));

          const rect = el.getBoundingClientRect();
          setPos({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });

          const prev = el.style.outline;
          el.style.outline = "2px solid #3b82f6";
          setTimeout(() => (el.style.outline = prev), 2000);
          send(ok());
          break;
        }

        case "DO_CLICK": {
          const el = findEl(req.id);
          if (!el) return send(elNotFound(req.id));
          el.click();
          send(ok());
          break;
        }

        case "DO_TYPE": {
          const el = findEl(req.id);
          if (!el) return send(elNotFound(req.id));
          if (!(el instanceof HTMLInputElement)) {
            return send({
              message: `Element with id=${req.id} is not an input, but an ${el.tagName}`,
              isError: true,
            });
          }

          el.focus();
          el.value = req.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          send(ok());
          break;
        }
      }
      return true;
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  return (
    <div
      className="fixed z-[2147483647] "
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <div className="flex gap-2">
        <Arrow />
        {thought && (
          <div className="mt-4 flex gap-3 shadow-lg bg-primary py-1 px-3 rounded-l-2xl rounded-r-2xl text-white text-sm">
            <p className=" max-w-[400px]">{thought}</p>
            {thinking && (
              <button
                className="cursor-pointer"
                onClick={async () => {
                  await sendToBg({ type: "STOP" });
                }}
                title="Stop Agent"
              >
                <div className="w-3 h-3 bg-white rounded-sm"></div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
