import { AsyncLocalStorage } from "node:async_hooks";

const nativeFetch = globalThis.fetch;
type Fetch = typeof globalThis.fetch;
const fetchScope = new AsyncLocalStorage<Fetch>();

// The official OKX SDK has no fetch injection option. Scope its unchanged
// signed requests to a bounded transport without affecting other callers.
globalThis.fetch = Object.assign(
  (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) =>
    (fetchScope.getStore() || nativeFetch)(input, init),
  nativeFetch,
);

// SDK decoding errors can include payment header snippets. Keep its diagnostics
// structured and value-free while preserving console behavior outside its scope.
for (const method of ["warn", "error"] as const) {
  const write = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    if (fetchScope.getStore()) {
      write(JSON.stringify({ time: new Date().toISOString(), level: method, code: "PAYMENT_SDK_DIAGNOSTIC" }));
    } else write(...args);
  };
}

export function withBoundedFetch<T>(fetch: Fetch, task: () => T): T {
  return fetchScope.run(fetch, task);
}

export function createBoundedFetch(options: { maxInFlight: number; timeoutMs: number; maxBytes: number }): Fetch {
  let active = 0;
  const bounded = async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    if (active >= options.maxInFlight) throw new Error("UPSTREAM_CAPACITY");
    active++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const parent = init?.signal || (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) controller.abort();
    try {
      const response = await nativeFetch(input, { ...init, signal: controller.signal, redirect: "error" });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > options.maxBytes) {
              controller.abort();
              throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      return new Response(reader ? Buffer.concat(chunks) : null, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } catch {
      throw new Error(controller.signal.aborted ? "UPSTREAM_TIMEOUT_OR_SIZE" : "UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
      active--;
    }
  };
  return Object.assign(bounded, nativeFetch);
}
