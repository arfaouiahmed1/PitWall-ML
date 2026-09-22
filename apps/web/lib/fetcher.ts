// Shared fetch plumbing for the PitWall ML cockpit.
//
// Every client fetch (backend API, OpenF1, Open-Meteo) goes through here so
// timeout / retry / visibility-pause behaviour is identical everywhere.
// Returns `null` on failure so callers keep their existing fallback data.

export const FETCH_TIMEOUT_MS = 3000;

export type FetchFailureReason = "timeout" | "network" | "http" | "json";
export type FetchJsonOptions = {
  /** Per-attempt timeout in ms. Default FETCH_TIMEOUT_MS (3000). */
  timeoutMs?: number;
  /** Extra retries after the first attempt. Default 0 (poll loops retry on the next tick anyway). */
  retries?: number;
  /** Base backoff delay in ms, doubled per attempt. Default 400. */
  retryBaseMs?: number;
  /** Observability hook: called once per failed fetch with the failure reason. */
  onFailure?: (reason: FetchFailureReason, status?: number) => void;
};

// Backoff / retry timing constants.
const BACKOFF_CAP_MS = 8000;
const BACKOFF_JITTER_MS = 120;
const RETRY_BASE_MS = 400;
const POST_TIMEOUT_MS = 15000;

/** Loose record guard for unwrapping backend wrapper payloads. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(base: number, attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, base * 2 ** attempt + Math.random() * BACKOFF_JITTER_MS);
}

export function isPageVisible(): boolean {
  if (typeof document === "undefined") return true;
  return !document.hidden;
}

function combinedSignal(
  external: AbortSignal | null | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(external?.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      try {
        ctrl.abort(new DOMException("Timeout", "TimeoutError"));
      } catch {
        ctrl.abort();
      }
    }, timeoutMs);
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

/** GET + parse JSON. Resolves `null` on timeout / network error / non-2xx / bad JSON. */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  opts?: FetchJsonOptions
): Promise<T | null> {
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retries = opts?.retries ?? 0;
  const base = opts?.retryBaseMs ?? RETRY_BASE_MS;
  const onFailure = opts?.onFailure;
  let attempt = 0;
  for (;;) {
    const { signal, cleanup } = combinedSignal(init?.signal ?? null, timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal });
      cleanup();
      if (!res.ok) {
        if (res.status >= 500 && attempt < retries) {
          await sleep(backoffMs(base, attempt));
          attempt++;
          continue;
        }
        onFailure?.("http", res.status);
        return null;
      }
      const parsed = await res.json().catch(() => undefined);
      if (parsed === undefined) {
        onFailure?.("json");
        return null;
      }
      return parsed as T;
    } catch (err) {
      cleanup();
      const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
      if (attempt < retries) {
        await sleep(backoffMs(base, attempt));
        attempt++;
        continue;
      }
      onFailure?.(isTimeout ? "timeout" : "network");
      return null;
    }
  }
}

/** POST JSON + parse JSON. No retries by default. Resolves `null` on failure. */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts?: FetchJsonOptions & { headers?: Record<string, string> }
): Promise<T | null> {
  return fetchJson<T>(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
      body: JSON.stringify(body),
    },
    { timeoutMs: POST_TIMEOUT_MS, retries: 0, ...(opts ?? {}) }
  );
}

/**
 * Interval polling that pauses while the tab is hidden and fires a catch-up
 * poll when the tab becomes visible again. Returns a cleanup function.
 * Callers must invoke `fn` once immediately if they want an instant first load.
 */
export function startPoller(fn: () => void, intervalMs: number): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  }
  const id = setInterval(() => {
    if (!document.hidden) fn();
  }, intervalMs);
  const onVis = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVis);
  };
}
