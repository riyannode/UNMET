import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createServer as createTcpServer, type Socket } from "node:net";
import { createServer, type TLSSocket } from "node:tls";
import { createValidationTransport, isPublicAddress, ValidationTransportError, type ValidationHttpRequest } from "./validation-transport";

const ip = "93.184.215.14";
const get: ValidationHttpRequest = { method: "GET", query: [], contentType: null, body: null };
const ca = readFileSync(process.env.VALIDATION_TEST_CA!, "utf8");
const key = readFileSync(process.env.VALIDATION_TEST_KEY!);
const cert = readFileSync(process.env.VALIDATION_TEST_CERT!);
const sockets = new Set<TLSSocket>();
let connections = 0;
let sni = "";
let received = "";
let bodySent = false;
let port: number;
const server = createServer({ key, cert }, (socket) => {
  connections++;
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
  sni = socket.servername || "";
  socket.once("data", (data) => {
    received = data.toString();
    const path = received.split(" ")[1];
    if (path === "/hang") return;
    if (path === "/immediate-fin") socket.end("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\nContent-Length: 0\r\n\r\n");
    else if (path === "/body") {
      socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\nContent-Length: 100\r\n\r\n");
      setTimeout(() => { if (!socket.destroyed) { bodySent = true; socket.write("business response"); } }, 50);
    } else if (path === "/informational") socket.write("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\n\r\n");
    else if (path === "/duplicate") socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\nPayment-Required: e30=\r\n\r\n");
    else if (path === "/late-duplicate") socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\n" + "X: y\r\n".repeat(2000) + "Payment-Required: e30=\r\n\r\n");
    else if (path === "/redirect") socket.write("HTTP/1.1 302 Found\r\nLocation: https://elsewhere.test/\r\n\r\n");
    else if (path === "/header-limit") socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: " + "a".repeat(16384) + "\r\n\r\n");
    else if (path === "/large") socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: " + "a".repeat(16385) + "\r\n\r\n");
    else if (path === "/many") socket.write("HTTP/1.1 402 Payment Required\r\nX-Fill: " + "a".repeat(33000) + "\r\n\r\n");
    else socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\nContent-Length: 999999\r\n\r\n");
  });
});
const url = (path = "/") => "https://fixture.test" + path;
const transport = (resolve: (hostname: string) => Promise<string[]> = async () => [ip], timeoutMs = 1000, trust = ca) =>
  createValidationTransport({ managementAddresses: [], resolve, timeoutMs, ca: trust, testOnlyPort: port });
const code = async (promise: Promise<unknown>) => {
  try { await promise; return "NO_ERROR"; }
  catch (error) { return error instanceof ValidationTransportError ? error.code : "UNEXPECTED"; }
};
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, ip, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address missing");
  port = address.port;
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("invalid targets and request shapes fail before DNS", async () => {
  let calls = 0;
  const inspect = transport(async () => { calls++; return [ip]; });
  for (const target of [
    "https://fixture.test:8443/", "http://fixture.test/", "https://user:pass@fixture.test/", "https://fixture.test/?x=1",
    "https://fixture.test/#fragment", "https://127.0.0.1/", "https://fixture.test/" + "x".repeat(512),
    "https://fixture.test/" + "é".repeat(250),
  ]) expect(await code(inspect(target, get))).toBe("INVALID_TARGET");
  const withHeaders = { ...get, headers: { Authorization: "x" } };
  expect(await code(inspect(url(), withHeaders))).toBe("INVALID_TARGET");
  expect(await code(inspect(url(), { ...get, query: Array.from({ length: 33 }, () => ["a", "b"]) }))).toBe("INVALID_TARGET");
  expect(await code(inspect(url(), { method: "POST", query: [], contentType: "application/json", body: "x".repeat(32769) }))).toBe("INVALID_TARGET");
  expect(calls).toBe(0);
});

test("public policy rejects special, mapped and management addresses", async () => {
  for (const address of ["127.0.0.1", "10.2.3.4", "100.64.0.1", "169.254.169.254", "192.0.2.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:8.8.8.8",
    "64:ff9b::808:808", "2001:db8::1", "2002:808:808::1", "2620:4f:8000::1", "fc00::1", "fe80::1"]) expect(isPublicAddress(address)).toBe(false);
  expect(isPublicAddress(ip)).toBe(true);
  expect(isPublicAddress("2606:4700::1111")).toBe(true);
  const inspect = createValidationTransport({ managementAddresses: [ip], resolve: async () => [ip], ca, testOnlyPort: port });
  expect(await code(inspect(url(), get))).toBe("UNSAFE_ADDRESS");
});

test("real TLS uses pinned peer and original SNI and Host", async () => {
  expect(await transport()(url("/ok"), get)).toEqual({ status: 402, paymentRequired: "e30=" });
  expect((await transport()("https://fixture.test:443/ok", get)).status).toBe(402);
  expect((await transport()("https://fixture.test:443/", get)).status).toBe(402);
  expect(sni).toBe("fixture.test");
  expect(received).toContain("Host: fixture.test\r\n");
  expect(received).toContain("Accept: application/json\r\n");
  for (const name of ["payment-signature", "x-payment", "authorization", "cookie"]) {
    expect(received.toLowerCase()).not.toContain(`\r\n${name}:`);
  }
});

test("global-shaped IPv6 reaches a real pinned peer", async () => {
  const server6 = createServer({ key, cert }, (socket) => {
    socket.once("data", () => socket.write("HTTP/1.1 402 Payment Required\r\nPayment-Required: e30=\r\n\r\n"));
  });
  await new Promise<void>((resolve, reject) => {
    server6.once("error", reject);
    server6.listen(0, "2606:4700::1111", resolve);
  });
  const address = server6.address();
  if (!address || typeof address === "string") throw new Error("missing IPv6 address");
  try {
    const inspect = createValidationTransport({ managementAddresses: [], resolve: async () => ["2606:4700::1111"], ca, testOnlyPort: address.port });
    expect((await inspect("https://fixture.test/", get)).status).toBe(402);
  } finally {
    await new Promise<void>((resolve) => server6.close(() => resolve()));
  }
});

test("valid 402 followed immediately by FIN succeeds", async () => {
  expect(await transport()(url("/immediate-fin"), get)).toEqual({ status: 402, paymentRequired: "e30=" });
});

test("POST sends canonical body and ordered query", async () => {
  const request: ValidationHttpRequest = { method: "POST", query: [["x", "2"], ["x", "1"]], contentType: "application/json", body: '{"a":2,"z":1}' };
  expect((await transport()(url("/post"), request)).status).toBe(402);
  expect(received).toContain("POST /post?x=2&x=1 HTTP/1.1\r\n");
  expect(received).toEndWith('{"a":2,"z":1}');
});

test("certificate identity and trust are enforced", async () => {
  expect(await code(transport()(url().replace("fixture.test", "wrong.test"), get))).toBe("TRANSPORT_UNAVAILABLE");
  expect(await code(transport(undefined, 1000, "")(url(), get))).toBe("TRANSPORT_UNAVAILABLE");
});

test("mixed DNS rejected and changed DNS rejected on next request", async () => {
  const before = connections;
  expect(await code(transport(async () => [ip, "127.0.0.1"])(url(), get))).toBe("UNSAFE_ADDRESS");
  expect(connections).toBe(before);
  let calls = 0;
  const inspect = transport(async () => ++calls === 1 ? [ip] : ["127.0.0.1"]);
  expect((await inspect(url(), get)).status).toBe(402);
  expect(await code(inspect(url(), get))).toBe("UNSAFE_ADDRESS");
  expect(calls).toBe(2);
});

test("redirect is returned without following and oversized headers fail", async () => {
  const before = connections;
  expect((await transport()(url("/redirect"), get)).status).toBe(302);
  expect(connections).toBe(before + 1);
  expect((await transport()(url("/header-limit"), get)).paymentRequired).toHaveLength(16384);
  expect(await code(transport()(url("/large"), get))).toBe("INVALID_RESPONSE");
  expect(await code(transport()(url("/many"), get))).toBe("INVALID_RESPONSE");
  expect(await code(transport()(url("/duplicate"), get))).toBe("INVALID_RESPONSE");
  expect(await code(transport()(url("/late-duplicate"), get))).toBe("INVALID_RESPONSE");
  expect((await transport()(url("/informational"), get)).status).toBe(402);
});

test("deadline stops late DNS, TLS handshake and headers", async () => {
  const before = connections;
  const delayed = transport(async () => { await Bun.sleep(120); return [ip]; }, 30);
  expect(await code(delayed(url(), get))).toBe("TRANSPORT_TIMEOUT");
  await Bun.sleep(160);
  expect(connections).toBe(before);
  const peers = new Set<Socket>();
  const tcp = createTcpServer((socket) => { peers.add(socket); socket.once("close", () => peers.delete(socket)); });
  await new Promise<void>((resolve) => tcp.listen(0, ip, resolve));
  const address = tcp.address();
  if (!address || typeof address === "string") throw new Error("missing TCP address");
  try {
    expect(await code(createValidationTransport({ managementAddresses: [], resolve: async () => [ip], ca, timeoutMs: 80, testOnlyPort: address.port })(url(), get))).toBe("TRANSPORT_TIMEOUT");
    expect(await code(transport(undefined, 80)(url("/hang"), get))).toBe("TRANSPORT_TIMEOUT");
  } finally {
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => tcp.close(() => resolve()));
  }
});

test("response body is not awaited and sockets are closed", async () => {
  expect((await transport()(url("/body"), get)).status).toBe(402);
  await Bun.sleep(100);
  expect(sockets.size).toBe(0);
  expect(bodySent).toBe(false);
});
