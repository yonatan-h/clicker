import { browser } from "wxt/browser";

const GEMINI_API_KEY = `api-key`;
const JEV_API_KEY = `jev-api-key`;
const GOAL = 'goal';

async function store(key: string, val: any) {
  await browser.storage.local.set({ [key]: JSON.stringify(val) });
}

async function get(key: string): Promise<any | null> {
  const res = await browser.storage.local.get(key);
  if (typeof res[key] === "string") {
    try {
      return JSON.parse(res[key]);
    } catch {
      return null;
    }
  }
  return res[key] || null;
}


export async function getGoal(): Promise<string | null> {
  const res = await get(GOAL);
  return res ? res.val : null;
}

export async function storeGoal(val: string) {
  return store(GOAL, { val });
}

export async function getGeminiApiKey(): Promise<string | null> {
  const res = await get(GEMINI_API_KEY);
  return res ? res.val : null;
}

export async function storeGeminiApiKey(val: string) {
  return store(GEMINI_API_KEY, { val });
}

export async function getJevApiKey(): Promise<string | null> {
  const res = await get(JEV_API_KEY);
  return res ? res.val : null;
}

export async function storeJevApiKey(val: string) {
  return store(JEV_API_KEY, { val });
}
