/**
 * Remembers an order that stopped because the wallet was short, so that
 * after an any-chain top-up lands the buyer agent can finish it on its own.
 * sessionStorage only: the order is retried in the same tab or not at all.
 */
const KEY = "borneo.resume-order.v1";
const MAX_AGE_MS = 60 * 60_000;

export type ResumableOrder<Line> = { lines: Line[]; savedAt: number };

export function saveResumableOrder<Line>(lines: Line[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ lines, savedAt: Date.now() }));
  } catch {
    // storage unavailable: the buyer just clicks Buy again
  }
}

export function takeResumableOrder<Line>(): Line[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumableOrder<Line>;
    if (!Array.isArray(parsed.lines) || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed.lines;
  } catch {
    return null;
  }
}
