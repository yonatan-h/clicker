import { browser } from "wxt/browser";

const API_KEY = `api-key`;
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

export async function getApiKey(): Promise<string | null> {
  const res = await get(API_KEY);
  return res ? res.val : null;
}

export async function getGoal(): Promise<string | null> {
  const res = await get(GOAL);
  return res ? res.val : null;
}

export async function storeGoal(val: string) {
  return store(GOAL, { val });
}

export async function storeApiKey(val: string) {
  return store(API_KEY, { val });
}
