import ReactDOM from "react-dom/client";
import "@/assets/tailwind.css";
import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { getApiKey } from "@/src/utils/storage";
import { type BGRequest, type BGResponse, sendToBg } from "@/src/utils/shared";
import { Button } from "@/components/ui/button";

console.log("here");

export default function Popup() {
  const [apiKey, setApiKey] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    getApiKey().then((key) => {
      if (key) setApiKey(key);
    });
  }, []);

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      alert("Please enter your Gemini API Key first.");
      return;
    }

    setIsStarting(true);
    const req: BGRequest = { type: "UPDATE_API_KEY", apiKey: trimmedKey };
    await sendToBg(req);
    setIsStarting(false);
  };

  const handleSnapshot = async () => {
    const req: BGRequest = { type: "CAPTURE_SNAPSHOT" };
    await sendToBg(req);
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

      <div className="flex flex-col gap-3 mt-2">
        <button
          onClick={handleSave}
          disabled={isStarting}
          className="bg-primary text-white font-bold p-2 rounded-full "
        >
          {isStarting ? "Saving..." : "Save API Key"}
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
