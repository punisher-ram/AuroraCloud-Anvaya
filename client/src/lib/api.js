const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
  } catch (e) {
    throw new Error(`Anvaya server is unreachable. Make sure Docker Compose is running (server on port 4000). ${e?.message || ""}`.trim());
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  health: () => request("/health"),
  models: () => request("/astra/models"),
  chat: (model, messages) => request("/astra/chat", { method: "POST", body: JSON.stringify({ model, messages }) }),
  weather: (city) => request(`/weather?city=${encodeURIComponent(city)}`),
  deleteAccount: (accessToken) => request("/account", { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } })
};
