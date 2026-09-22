import { fetchJson } from "./fetcher";

const isBrowser = typeof window !== "undefined";
const isStaticExport =
  process.env.STATIC_EXPORT === "true" ||
  process.env.GITHUB_PAGES === "true" ||
  (isBrowser && !window.location.host.includes("localhost") && !window.location.host.includes("127.0.0.1"));

function resolveApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (!isStaticExport) {
    return "http://localhost:8000";
  }
  return "";
}

function resolveWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
  }
  if (!isStaticExport) {
    return "ws://localhost:8000";
  }
  return "";
}

export const API_URL = resolveApiUrl();
export const WS_URL = resolveWsUrl();

export function isApiConfigured(): boolean {
  return Boolean(API_URL);
}

export async function fetchHealth() {
  if (!API_URL) return null;
  return fetchJson(`${API_URL}/health`);
}

export async function fetchPredictions() {
  if (!API_URL) return null;
  return fetchJson(`${API_URL}/predictions/pace`);
}

// Shared plumbing, re-exported so existing `lib/api` imports keep working.
export { fetchJson, postJson, startPoller, isPageVisible, isRecord, num } from "./fetcher";
export type { FetchJsonOptions } from "./fetcher";
