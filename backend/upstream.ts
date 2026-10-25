import { AsyncLocalStorage } from "node:async_hooks";

const nativeFetch = globalThis.fetch;
type Fetch = typeof globalThis.fetch;
const fetchScope = new AsyncLocalStorage<Fetch>();
const deadlineScope = new AsyncLocalStorage<number>();

function withDeadline(fetch: Fetch, deadline: number): Fetch {
  return Object.assign((input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error("UPSTREAM_TIMEOUT_OR_SIZE"));
    const signals = [init?.signal, input instanceof Request ? input.signal : undefined, AbortSignal.timeout(remaining)]
      .filter((signal): signal is AbortSignal => signal !== undefined);
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  }, fetch);
}

// The official OKX SDK has no fetch injection option. Scope its unchanged
// signed requests to a bounded transport without affecting other callers.
globalThis.fetch = Object.assign(
  (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const fetch = fetchScope.getStore() || nativeFetch;
    const deadline = deadlineScope.getStore();
    return (deadline === undefined ? fetch : withDeadline(fetch, deadline))(input, init);
  },
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

export function withBoundedFetchDeadline<T>(deadline: number, task: () => T): T {
  const current = deadlineScope.getStore();
  return deadlineScope.run(current === undefined ? deadline : Math.min(current, deadline), task);
}

export function settleStatusErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const transient = message === "UPSTREAM_TIMEOUT_OR_SIZE" || message === "UPSTREAM_UNAVAILABLE" || message === "UPSTREAM_CAPACITY" ||
    /^Facilitator getSettleStatus failed \((?:408|429|5\d\d)\):/.test(message);
  return transient ? "PAYMENT_STATUS_TEMPORARY" : "PAYMENT_STATUS_UNAVAILABLE";
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
    let responseTooLarge = false;
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
              responseTooLarge = true;
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
      if (responseTooLarge) throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
      throw new Error(controller.signal.aborted ? "UPSTREAM_TIMEOUT_OR_SIZE" : "UPSTREAM_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
      active--;
    }
  };
  return Object.assign(bounded, nativeFetch);
}
