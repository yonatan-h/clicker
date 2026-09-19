import "@/assets/tailwind.css";
import React, { useEffect, useState } from "react";
import { getGeminiApiKey } from "@/src/utils/storage";
import { type BGRequest, type BGResponse, sendToBg } from "@/src/utils/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


export default function Popup() {
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [jevApiKey, setJevApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getGeminiApiKey().then((key) => {
      if (key) setGeminiApiKey(key);
    });
  }, []);

  const handleSave = async () => {
    if (!geminiApiKey.trim()) {
      alert("Please enter your Gemini API Key first.");
      return;
    }

    if (!jevApiKey.trim()) {
      alert("Please enter your Jev API Key first.");
      return;
    }

    setIsSaving(true);
    const req: BGRequest = {
      type: "UPDATE_API_KEYS",
      geminiApiKey: geminiApiKey.trim(),
      jevApiKey: jevApiKey.trim(),
    };
    await sendToBg(req);
    setIsSaving(false);
  };

  return (
    <div className="rounded flex-1 bg-white p-4 w-80 flex flex-col gap-4 text-gray-800">
      <h2 className="text-xl font-black text-primary text-center mb-2">
        Clicker
      </h2>

      <div className="flex flex-col gap-2">
        <Label
          htmlFor="gemini-api-key"
          className="text-gray-500 font-semibold ml-1"
        >
          Gemini API Key
        </Label>
        <Input
          id="gemini-api-key"
          type="password"
          value={geminiApiKey}
          onChange={(e) => setGeminiApiKey(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label
          htmlFor="jev-api-key"
          className="text-gray-500 font-semibold ml-1"
        >
          Jev API Key
        </Label>
        <Input
          id="jev-api-key"
          type="password"
          value={jevApiKey}
          onChange={(e) => setJevApiKey(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2 mt-4">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full font-bold"
        >
          {isSaving ? "Saving..." : "Save API Keys"}
        </Button>
      </div>
    </div>
  );
}
