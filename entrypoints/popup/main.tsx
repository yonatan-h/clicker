import ReactDOM from "react-dom/client";
import "@/assets/tailwind.css";
import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  getApiKey,
  getGoal,
  storeApiKey,
  storeGoal,
} from "@/src/utils/storage";

console.log("here");

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [goal, setGoal] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    Promise.all([getApiKey(), getGoal()]).then(([key, g]) => {
      if (key) setApiKey(key);
      if (g) setGoal(g);
    });
  }, []);

  const handleStart = async () => {
    const trimmedKey = apiKey.trim();
    const trimmedGoal = goal.trim();

    if (!trimmedKey) {
      alert("Please enter your Gemini API Key first.");
      return;
    }
    if (!trimmedGoal) {
      alert("Please enter a goal.");
      return;
    }

    setIsStarting(true);
    await storeApiKey(trimmedKey);
    await storeGoal(trimmedGoal);
    await browser.runtime.sendMessage({ action: "START", goal: trimmedGoal });
  };

  const handleSnapshot = async () => {
    await browser.runtime.sendMessage({ action: "SNAPSHOT" });
  };

  return (
    <div className="rounded flex-1 bg-white p-3 w-80 flex flex-col gap-3 text-gray-800">
      <h2 className="text-xl font-black text-primary text-center">Clicker</h2>

      <div className="flex flex-col gap-1">
        <label className="text-xl font-bold text-gray-500 ml-2">Api Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="rounded-2xl bg-gray-50  border-gray-400  p-2 "
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xl font-bold text-gray-500 ml-2">Goal</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={5}
          placeholder="What should I do?"
          className="bg-gray-50 border-1 border-gray-400 rounded-2xl p-2"
        />
      </div>

      <div className="flex flex-col gap-3 mt-2">
        <button
          onClick={handleStart}
          disabled={isStarting}
          className="bg-primary text-white font-bold p-2 rounded-full "
        >
          {isStarting ? "Starting..." : "Start"}
        </button>
        <button
          onClick={handleSnapshot}
          className="bg-gray-100 text-gray-600 font-bold p-2 rounded-full "
        >
          Snapshot
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
