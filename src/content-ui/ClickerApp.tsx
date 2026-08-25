import { browser } from "wxt/browser";
import { useState, useEffect } from "react";
import {
  ID_ATTR,
  type UIResponse,
  type UIRequest,
  type AgentUIState,
  sendToBg,
} from "@/src/utils/shared";
import Arrow from "./arrow/Arrow";

export default function ClickerApp() {
  const [uiState, setUiState] = useState<AgentUIState>({
    targetId: null,
    state: 'not-started',
    isThinking: false,
    thought: null,
  });
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 10, y: 10 });

  const findEl = (id: number): HTMLElement | null => {
    const el = document.querySelector(`[${ID_ATTR}="${id}"]`);
    if (!(el instanceof HTMLElement)) return null;
    return el;
  };

  useEffect(() => {
    const updatePos = () => {
      if (uiState.targetId !== null) {
        const el = findEl(uiState.targetId);
        if (el) {
          const rect = el.getBoundingClientRect();
          setPos({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
          return;
        }
      }
      
      setPos({
        x: window.innerWidth / 4,
        y: window.innerHeight / 4,
      });
    };

    updatePos();
    const interval = setInterval(updatePos, 1000);
    return () => clearInterval(interval);
  }, [uiState.targetId]);

  useEffect(() => {
    sendToBg({ type: "GET_STATE" }).then((res) => {
      if (res.isOk && res.state) {
        setUiState(res.state);
      }
    });

    const listener = (
      _request: unknown,
      _sender: any,
      _sendResponse: Function,
    ) => {
      const req = _request as UIRequest;
      setUiState(req.state);

      const send = (resp: UIResponse) => {
        _sendResponse(resp);
      };

      const elNotFound = (id: number) => ({
        message: `Element with id=${id} not found`,
        isError: true,
      });
      const ok = () => ({
        message: `Ok`,
        isError: false,
      });

      switch (req.type) {
        case "SYNC_STATE": {
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
      className="fixed z-[2147483647] pointer-events-none transition-all duration-300 ease-out"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <div className="flex gap-2">
        <Arrow />
        {(uiState.thought || uiState.isThinking) && (
          <div className=" flex gap-3 shadow-lg bg-primary py-1 px-3 rounded-l-2xl rounded-r-2xl text-white text-sm w-[300px]">
            <div className="flex-1">
              {uiState.thought && (
                <p className=" ">{uiState.thought}</p>
              )}
              {uiState.isThinking && (
                <div className="flex items-center gap-1  h-3">
                  <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce"></div>
                </div>
              )}
            </div>
            {uiState.state === 'running' && (
              <button
                className="cursor-pointer pointer-events-auto"
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
