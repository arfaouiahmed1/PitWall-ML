export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";

export async function fetchHealth() {
  const r = await fetch(`${API_URL}/health`);
  return r.json();
}
export async function fetchPredictions() {
  const r = await fetch(`${API_URL}/predictions/pace`);
  return r.json();
}
