import { browser } from "wxt/browser";
import { useState, useEffect, useRef } from "react";
import {
  ID_ATTR,
  type UIResponse,
  type UIState,
  sendToBg,
} from "@/src/utils/shared";
import {
  getGeminiApiKey,
  getGoal,
  getJevApiKey,
  storeGoal,
} from "@/src/utils/storage";
import Arrow from "./arrow/Arrow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, RotateCcw, Square, Loader2 } from "lucide-react";

export default function ClickerApp() {
  const [uiState, setUiState] = useState<UIState>({
    targetId: null,
    isThinking: false,
    isRunning: false,
    thoughts: [],
    lastInput: "",
    awaitedAnimMs: 150,
    ask: null,
  });
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== "undefined" ? window.innerWidth / 4 : 50,
    y: typeof window !== "undefined" ? window.innerHeight / 4 : 50,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [input, setInput] = useState("");
  const [customAnswer, setCustomAnswer] = useState("");

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

  const handleStart = async () => {
    const trimmed = input.trim();
    if (!trimmed) {
      alert("Please enter a goal.");
      return;
    }

    if (!(await getGeminiApiKey()) && !(await getJevApiKey())) {
      alert(
        "Please open the extension popup and set your Gemini API Key first.",
      );
      return;
    }

    await storeGoal(trimmed);
    await sendToBg({ type: "START", text: trimmed });
  };

  const handleAnswer = (ans: string) => {
    if (uiState.ask) {
      sendToBg({ type: "ANSWER", id: uiState.ask.id, ans });
      setCustomAnswer("");
    }
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
          el.scrollIntoView({ behavior: "smooth", block: "center" });
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
        if (res.state?.lastInput) {
          setInput(res.state.lastInput);
        }
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

  const showAsk = uiState.isRunning && uiState.ask != null;
  const showSpinner = !showAsk && uiState.isThinking;
  const showStop = !showAsk && uiState.isRunning;
  const showThought = !showAsk && uiState.thoughts.length > 0;
  const showActivityStatus = !showAsk && uiState.isRunning;
  const showInput = !showAsk && !showActivityStatus;
  const showIdleBar = showAsk || !uiState.isRunning;
  const showResetButton = !uiState.isRunning && uiState.thoughts.length > 0;

  return (
    <div
      className={`fixed z-[2147483647] flex gap-1 text-foreground text-sm ${
        isDragging ? "transition-none select-none" : "transition-all ease-out"
      }`}
      style={{
        animationDuration: uiState.awaitedAnimMs + "ms",
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
                className="px-2 min-h-4 flex  items-center text-xs text-white/90  flex-1 cursor-grab active:cursor-grabbing select-none"
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

          {showAsk && uiState.ask && (
            <div className="px-2 pb-2 text-white">
              <p className="text-xs py-2">{uiState.ask.question}</p>
              <div className="flex flex-col gap-1">
                {uiState.ask.options.map((opt, i) => (
                  <Button
                    key={i}
                    variant={"ghost"}
                    className="justify-start  bg-white/10 rounded-sm text-xs"
                    onClick={() => handleAnswer(opt)}
                  >
                    {i + 1}. {opt}
                  </Button>
                ))}
                {uiState.ask.includeOther && (
                  <form
                    className="flex"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAnswer(customAnswer);
                    }}
                  >
                    <Textarea
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      placeholder={`${uiState.ask.options.length > 0 ? `${uiState.ask.options.length + 1}. Or type` : "Type"} your answer...`}
                      className="text-background min-h-7 resize-none bg-white/10 outline-none border border-white/20 rounded-sm"
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
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
