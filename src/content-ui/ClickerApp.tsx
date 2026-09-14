import { browser } from "wxt/browser";
import { useState, useEffect, useRef } from "react";
import {
  ID_ATTR,
  type UIResponse,
  type UIRequest,
  type UIState,
  sendToBg,
} from "@/src/utils/shared";
import { getApiKey, getGoal, storeGoal } from "@/src/utils/storage";
import Arrow from "./arrow/Arrow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, RotateCcw, Square, Loader2 } from "lucide-react";

export default function ClickerApp() {
  const [uiState, setUiState] = useState<UIState>({
    goal: "",
    targetId: null,
    isThinking: false,
    isRunning: false,
    thoughts: [],
  });
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== "undefined" ? window.innerWidth / 4 : 50,
    y: typeof window !== "undefined" ? window.innerHeight / 4 : 50,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    posX: number;
    posY: number;
  }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    setPos({
      x: dragStartRef.current.posX + dx,
      y: dragStartRef.current.posY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const [input, setInput] = useState("");

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
      request: unknown,
      _sender: any,
      sendResponse: Function,
    ) => {
      setUiState(request as UIState);
      sendResponse(true);
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const showSpinner = uiState.isThinking;
  const showStop = uiState.isRunning;
  const showThought = uiState.thoughts.length > 0;
  const showActivityStatus = uiState.isRunning;
  const showInput = !showActivityStatus;
  const showIdleBar = !uiState.isRunning;
  const showResetButton = !uiState.isRunning && uiState.thoughts.length > 0;

  return (
    <div
      className={`fixed z-[2147483647] flex gap-1 text-foreground text-sm ${
        isDragging
          ? "transition-none select-none"
          : "transition-all duration-300 ease-out"
      }`}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    >
      <Arrow />

      <div className="flex flex-col mt-3">
        <div className=" rounded-b rounded w-[300px]  bg-primary ">
          {showActivityStatus && (
            <div className="flex items-center justify-between gap-1 px-2 py-1 ">
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                title="Drag to move"
                className="flex items-center gap-2 min-w-0 flex-1 cursor-grab active:cursor-grabbing select-none"
              >
                {showSpinner && (
                  <Loader2 className="w-3 h-3 shrink-0 animate-spin text-white/90" />
                )}

                {showThought && (
                  <span className="text-xs text-white/90">
                    {uiState.thoughts[uiState.thoughts.length - 1]}
                  </span>
                )}
              </div>

              {showStop && (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="shrink-0 rounded-full"
                  type="button"
                  onClick={async () => {
                    await sendToBg({ type: "STOP" });
                  }}
                  title="Stop Agent"
                >
                  <Square className="size-3 fill-current" />
                </Button>
              )}
            </div>
          )}

          {showIdleBar && (
            <div className="flex items-center justify-between gap-1 border-white/10">
              <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                title="Drag to move"
                className="px-2 min-h-4 flex items-center text-xs text-white/90  flex-1 cursor-grab active:cursor-grabbing select-none"
              >
                {showThought && (
                  <span>{uiState.thoughts[uiState.thoughts.length - 1]}</span>
                )}
              </div>
              {showResetButton && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={async () => {
                    await sendToBg({ type: "RESET" });
                    setInput("");
                    setUiState((prev) => ({
                      ...prev,
                      isRunning: false,
                      isThinking: false,
                      thoughts: [],
                      targetId: null,
                    }));
                  }}
                  title="Reset Context"
                  className="shrink-0 text-white/80 hover:text-white"
                >
                  <RotateCcw className="size-3" />
                </Button>
              )}
            </div>
          )}

          {showInput && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStart();
              }}
              className="relative"
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="How can I help?"
                className="min-h-8  pr-8 text-background resize-none bg-white/10 outline-none rounded border border-white/20"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.ctrlKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    handleStart();
                  }
                }}
              />
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute right-1 bottom-1 rounded-full"
                type="submit"
                title="Send"
              >
                <ArrowRight className="size-3.5" />
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
