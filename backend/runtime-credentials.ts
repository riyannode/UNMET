import { readFileSync } from "node:fs";

const names = ["OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE"] as const;

export function loadRuntimeCredentials(env: Record<string, string | undefined> = process.env): () => void {
  if (!env.OKX_CREDENTIALS_PATH) return () => {};
  try {
    const value: unknown = JSON.parse(readFileSync(env.OKX_CREDENTIALS_PATH, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...names].sort().join(",")) throw new Error();
    const entries = Object.entries(value);
    for (const [name, item] of entries) if (env[name] || typeof item !== "string" || !item.trim()) throw new Error();
    for (const [name, item] of entries) if (typeof item === "string") env[name] = item;
    return () => { for (const name of names) delete env[name]; };
  } catch { throw new Error("CONFIG_INVALID: OKX_CREDENTIALS_PATH"); }
}
