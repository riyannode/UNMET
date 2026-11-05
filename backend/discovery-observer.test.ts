import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { prepareObserverSocket } from "./discovery-observer.ts";

test("observer socket recovery refuses files and live sockets and removes owned stale sockets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "unmet-socket-")), path = join(dir, "observer.sock");
  try {
    writeFileSync(path, "not a socket");
    await expect(prepareObserverSocket(path)).rejects.toThrow("DISCOVERY_SOCKET_UNAVAILABLE");
    rmSync(path);
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
    try { await expect(prepareObserverSocket(path)).rejects.toThrow("DISCOVERY_SOCKET_UNAVAILABLE"); }
    finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    const child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(process.argv[1],()=>process.exit(0))", path], { stdio: "ignore" });
    const exit = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    expect(exit).toBe(0); expect(existsSync(path)).toBe(true);
    await prepareObserverSocket(path);
    expect(existsSync(path)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
