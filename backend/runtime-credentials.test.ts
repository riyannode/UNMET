import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeCredentials } from "./runtime-credentials.ts";

test("file credentials are available during startup and removed by cleanup", () => {
  const directory = mkdtempSync(join(tmpdir(), "unmet-credentials-"));
  try {
    const path = join(directory, "credentials.json");
    const values = { OKX_API_KEY: "test-api", OKX_SECRET_KEY: "test-secret", OKX_PASSPHRASE: "test-passphrase" };
    writeFileSync(path, JSON.stringify(values), { mode: 0o600 });
    const env: Record<string, string | undefined> = { OKX_CREDENTIALS_PATH: path, NODE_ENV: "production" };
    const clear = loadRuntimeCredentials(env);
    expect(env).toEqual({ OKX_CREDENTIALS_PATH: path, NODE_ENV: "production", ...values });
    clear();
    expect(env).toEqual({ OKX_CREDENTIALS_PATH: path, NODE_ENV: "production" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid credential files and mixed sources fail without partially loading values", () => {
  const directory = mkdtempSync(join(tmpdir(), "unmet-credentials-"));
  try {
    const path = join(directory, "credentials.json");
    for (const value of [null, [], {}, { OKX_API_KEY: "test", OKX_SECRET_KEY: 1, OKX_PASSPHRASE: "test" }, { OKX_API_KEY: "test", OKX_SECRET_KEY: "test", OKX_PASSPHRASE: " " }, { OKX_API_KEY: "test", OKX_SECRET_KEY: "test", OKX_PASSPHRASE: "test", extra: "test" }]) {
      writeFileSync(path, JSON.stringify(value));
      const env = { OKX_CREDENTIALS_PATH: path };
      expect(() => loadRuntimeCredentials(env)).toThrow("CONFIG_INVALID: OKX_CREDENTIALS_PATH");
      expect(env).toEqual({ OKX_CREDENTIALS_PATH: path });
    }
    writeFileSync(path, JSON.stringify({ OKX_API_KEY: "test", OKX_SECRET_KEY: "test", OKX_PASSPHRASE: "test" }));
    const env = { OKX_CREDENTIALS_PATH: path, OKX_API_KEY: "existing" };
    expect(() => loadRuntimeCredentials(env)).toThrow("CONFIG_INVALID: OKX_CREDENTIALS_PATH");
    expect(env).toEqual({ OKX_CREDENTIALS_PATH: path, OKX_API_KEY: "existing" });
    expect(() => loadRuntimeCredentials({ OKX_CREDENTIALS_PATH: join(directory, "missing") })).toThrow("CONFIG_INVALID: OKX_CREDENTIALS_PATH");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("legacy environment configuration remains unchanged", () => {
  const env = { OKX_API_KEY: "existing", OKX_SECRET_KEY: "existing", OKX_PASSPHRASE: "existing" };
  loadRuntimeCredentials(env)();
  expect(env).toEqual({ OKX_API_KEY: "existing", OKX_SECRET_KEY: "existing", OKX_PASSPHRASE: "existing" });
});
