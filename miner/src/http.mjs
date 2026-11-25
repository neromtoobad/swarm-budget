// Small fetch helpers: a timeout on every upstream call, one retry, and a bounded in-memory cache.

export class UpstreamError extends Error {
  constructor(message, { url, status } = {}) {
    super(message);
    this.code = "upstream_unavailable";
    this.status = 502;
    this.url = url;
    this.upstreamStatus = status;
  }
}

export async function getJson(url, { timeoutMs = 8000, headers = {}, retries = 1 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: ac.signal });
      if (res.ok) return await res.json();
      const text = await res.text().catch(() => "");
      last = new UpstreamError(`${new URL(url).host} answered ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`, { url, status: res.status });
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw last; // our request is wrong; a retry will not help
    } catch (e) {
      if (e instanceof UpstreamError && e.upstreamStatus >= 400 && e.upstreamStatus < 500 && e.upstreamStatus !== 429) throw e;
      last = e instanceof UpstreamError ? e : new UpstreamError(`${new URL(url).host} did not answer (${e.name === "AbortError" ? `no reply in ${timeoutMs} ms` : e.message})`, { url });
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw last;
}

const store = new Map(); // key -> { at, ttl, value }
const inflight = new Map(); // key -> Promise, so ten callers asking the same thing make one upstream call
const MAX_ENTRIES = 4000;
export const cacheStats = { hits: 0, misses: 0 };

export async function cached(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    cacheStats.hits++;
    return hit.value;
  }
  if (inflight.has(key)) return inflight.get(key);
  cacheStats.misses++;
  const p = (async () => {
    try {
      const value = await load();
      if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
      store.set(key, { at: Date.now(), ttl: ttlMs, value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export const clearCache = () => store.clear();
