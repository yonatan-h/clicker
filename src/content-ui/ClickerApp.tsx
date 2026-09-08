import { browser } from "wxt/browser";
import { useState, useEffect, useRef } from "react";
import {
  ID_ATTR,
  type UIResponse,
  type UIRequest,
  type AgentUIState,
  sendToBg,
} from "@/src/utils/shared";
import { getApiKey, getGoal, storeGoal } from "@/src/utils/storage";
import Arrow from "./arrow/Arrow";

export default function ClickerApp() {
  const [uiState, setUiState] = useState<AgentUIState>({
    goal: "",
    targetId: null,
    state: "not-started",
    isThinking: false,
    thought: null,
  });
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 10, y: 10 });
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      // Add 2px to account for the top and bottom borders, otherwise it overflows by 2px and triggers the scrollbar
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight + 2}px`;
    }
  }, [input, uiState.state]);

  const handleStart = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      alert("Please enter a goal.");
      return;
    }

    const key = await getApiKey();
    if (!key) {
      alert(
        "Please open the extension popup and set your Gemini API Key first.",
      );
      return;
    }

    await storeGoal(trimmed);
    await sendToBg({ type: "START", text: trimmed });
  };

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
    };

    updatePos();
    const interval = setInterval(updatePos, 1000);
    return () => clearInterval(interval);
  }, [uiState.targetId]);

  useEffect(() => {
    sendToBg({ type: "GET_STATE" }).then((res) => {
      if (res.isOk && res.state) {
        setUiState(res.state);
        setInput(res.state.goal);
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
          if (
            !(el instanceof HTMLInputElement) &&
            !(el instanceof HTMLTextAreaElement)
          ) {
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

  const evalPos = uiState.targetId
    ? pos
    : {
        x: window.innerWidth / 4,
        y: window.innerHeight / 4,
      };

  return (
    <div
      className="fixed z-[2147483647] transition-all duration-300 ease-out flex gap-1"
      style={{
        left: `${evalPos.x}px`,
        top: `${evalPos.y}px`,
      }}
    >
      <Arrow />

      <div className="flex flex-col">
        <div className="flex justify-end">
          <div className="flex  gap-2">
            <button>min</button>
            <button>max</button>
          </div>
        </div>
        <div className="mt-3 bg-primary rounded-b-2xl rounded-2xl w-[300px] text-white border-white ">
          <div className="flex gap-2">
            {(uiState.thought || uiState.isThinking) && (
              <div className="flex-1 p-2">
                {uiState.thought && (
                  <p className="text-xs">{uiState.thought}</p>
                )}

                {uiState.isThinking && (
                  <div className="flex items-center gap-1   h-3">
                    <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1 h-1 bg-white/80 rounded-full animate-bounce"></div>
                  </div>
                )}
              </div>
            )}
            {uiState.state === "running" && (
              <button
                className="cursor-pointer pointer-events-auto"
                onClick={async () => {
                  await sendToBg({ type: "STOP" });
                }}
                title="Stop Agent"
              >
                <div className="w-4 h-4 mx-2 bg-white rounded-sm"></div>
              </button>
            )}
            {uiState.state === "finished" && (
              <button
                className=" flex items-center opacity-70 text-xs px-2 hover:opacity-100"
                onClick={async () => {
                  await sendToBg({ type: "RESET" });
                  setInput("");
                }}
                title="Reset Context"
              >
                Reset
              </button>
            )}
          </div>

          {uiState.state !== "running" && (
            <div className="relative pointer-events-auto">
              <textarea
                ref={textareaRef}
                className="block bg-white/10 border-white/20 border w-full p-2 pr-12 rounded-2xl shadow-lg text-sm  resize-none focus:outline-none max-h-40 overflow-y-auto"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder=" What should I do?"
                rows={1}
              />
              <button
                className="absolute right-2 bottom-2 bg-white text-primary font-bold p-1 px-3 text-xs rounded-2xl shadow"
                onClick={handleStart}
              >
                Go
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
