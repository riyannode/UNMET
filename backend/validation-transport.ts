import { Resolver } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { connect, type TLSSocket } from "node:tls";
import { Agent, request as httpsRequest } from "node:https";
import type { ClientRequest } from "node:http";

export type TransportErrorCode = "INVALID_TARGET" | "UNSAFE_ADDRESS" | "DNS_UNAVAILABLE" | "TRANSPORT_UNAVAILABLE" | "TRANSPORT_TIMEOUT" | "INVALID_RESPONSE";
export class ValidationTransportError extends Error {
  constructor(readonly code: TransportErrorCode) { super(code); }
}
export type ValidationHttpRequest = {
  method: "GET" | "POST";
  query: [string, string][];
  contentType: "application/json" | null;
  body: string | null;
};
type TransportOptions = {
  managementAddresses: string[];
  resolve?: (hostname: string) => Promise<string[]>;
  ca?: string;
  timeoutMs?: number;
  // Trusted test seam for exercising TLS against an isolated namespace fixture.
  testOnlyPort?: number;
};

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.31.196.0", 24], ["192.52.193.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["192.175.48.0", 24],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) denied.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["2620:4f:8000::", 48], ["3fff::", 20],
] as const) denied.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !denied.check(address, family === 4 ? "ipv4" : "ipv6") && (family === 4 || globalV6.check(address, "ipv6"));
}
function validString(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
function target(serviceUrl: string, request: ValidationHttpRequest): { url: URL; body: string } {
  let url: URL;
  try { url = new URL(serviceUrl); } catch { throw new ValidationTransportError("INVALID_TARGET"); }
  if (Buffer.byteLength(serviceUrl) > 512 || (url.href !== serviceUrl && serviceUrl.replace(/:443(?=\/|$)/, "") !== url.href) || url.protocol !== "https:" || url.port ||
      url.username || url.password || serviceUrl.includes("?") || serviceUrl.includes("#") ||
      !url.hostname || isIP(url.hostname.replace(/^\[|\]$/g, ""))) throw new ValidationTransportError("INVALID_TARGET");
  if (!request || Object.keys(request).sort().join(",") !== "body,contentType,method,query" ||
      !Array.isArray(request.query) || request.query.length > 32 ||
      request.query.some((pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((part) => typeof part !== "string" || !validString(part)))) throw new ValidationTransportError("INVALID_TARGET");
  for (const [name, value] of request.query) url.searchParams.append(name, value);
  let body = "";
  if (request.method === "GET" && request.contentType === null && request.body === null) body = "";
  else if (request.method === "POST" && request.contentType === "application/json" &&
           typeof request.body === "string" && validString(request.body)) body = request.body;
  else throw new ValidationTransportError("INVALID_TARGET");
  if (Buffer.byteLength(url.href) > 2048 || Buffer.byteLength(body) > 32768) throw new ValidationTransportError("INVALID_TARGET");
  return { url, body };
}
async function resolveAll(resolver: Resolver, hostname: string): Promise<string[]> {
  const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  for (const result of results) if (result.status === "rejected") {
    const reason: unknown = result.reason;
    const code = typeof reason === "object" && reason !== null && "code" in reason ? reason.code : undefined;
    if (code !== "ENODATA" && code !== "ENOTFOUND") throw new ValidationTransportError("DNS_UNAVAILABLE");
  }
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}

/** Unmounted primitive: trusted configuration and prevalidated canonical POST bytes are supplied by the future service. */
export function createValidationTransport(options: TransportOptions) {
  const management = new BlockList();
  for (const address of options.managementAddresses) {
    const family = isIP(address);
    if (!family) throw new ValidationTransportError("INVALID_TARGET");
    management.addAddress(address, family === 4 ? "ipv4" : "ipv6");
  }
  const timeoutMs = options.timeoutMs ?? 10000;
  if (options.testOnlyPort !== undefined && (!options.resolve || options.ca === undefined || !Number.isInteger(options.testOnlyPort) || options.testOnlyPort < 1 || options.testOnlyPort > 65535)) throw new ValidationTransportError("INVALID_TARGET");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10000) throw new ValidationTransportError("INVALID_TARGET");

  return async function inspect(serviceUrl: string, request: ValidationHttpRequest): Promise<{ status: number; paymentRequired: string | null }> {
    const { url, body } = target(serviceUrl, request);
    const resolver = new Resolver();
    return await new Promise((resolve, reject) => {
      let finished = false;
      let socket: TLSSocket | undefined;
      let requestHandle: ClientRequest | undefined;
      let agent: Agent | undefined;
      const finish = (error?: ValidationTransportError, result?: { status: number; paymentRequired: string | null }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolver.cancel();
        requestHandle?.destroy();
        agent?.destroy();
        socket?.destroy();
        if (error) reject(error);
        else if (result) resolve(result);
      };
      let resolving = !!options.resolve;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (!resolving) finish(new ValidationTransportError("TRANSPORT_TIMEOUT"));
      }, timeoutMs);
      void (async () => {
        try {
          const addresses = await (options.resolve ? options.resolve(url.hostname) : resolveAll(resolver, url.hostname));
          resolving = false;
          if (timedOut) { finish(new ValidationTransportError("TRANSPORT_TIMEOUT")); return; }
          if (finished) return;
          if (!Array.isArray(addresses) || addresses.length === 0) {
            finish(new ValidationTransportError("DNS_UNAVAILABLE"));
            return;
          }
          if (addresses.some((address) => {
            const family = isIP(address);
            return !isPublicAddress(address) || management.check(address, family === 4 ? "ipv4" : "ipv6");
          })) {
            finish(new ValidationTransportError("UNSAFE_ADDRESS"));
            return;
          }
          const address = addresses[0];
          const connection = connect({ host: address, port: options.testOnlyPort ?? 443, servername: url.hostname, rejectUnauthorized: true, ca: options.ca });
          socket = connection;
          connection.on("error", () => finish(new ValidationTransportError("TRANSPORT_UNAVAILABLE")));
          connection.once("secureConnect", () => {
            if (finished) return;
            const peer = connection.remoteAddress;
            const peerFamily = peer ? isIP(peer) : 0;
            const chosen = new BlockList();
            chosen.addAddress(address, isIP(address) === 4 ? "ipv4" : "ipv6");
            if (!peer || !peerFamily || !chosen.check(peer, peerFamily === 4 ? "ipv4" : "ipv6")) {
              finish(new ValidationTransportError("UNSAFE_ADDRESS"));
              return;
            }
            agent = new Agent({ keepAlive: false, maxSockets: 1 });
            agent.createConnection = () => connection;
            const headers: Record<string, string> = { Host: url.host, Accept: "application/json", Connection: "close" };
            if (request.method === "POST") {
              headers["Content-Type"] = "application/json";
              headers["Content-Length"] = String(Buffer.byteLength(body));
            }
            requestHandle = httpsRequest({
              hostname: url.hostname, port: options.testOnlyPort ?? 443, path: url.pathname + url.search,
              method: request.method, agent, headers, maxHeaderSize: 32768,
            }, (response) => {
              if (finished) { response.destroy(); return; }
              const values: string[] = [];
              for (let i = 0; i < response.rawHeaders.length; i += 2) {
                if (response.rawHeaders[i].toLowerCase() === "payment-required") values.push(response.rawHeaders[i + 1]);
              }
              if (values.length > 1 || (values[0] && Buffer.byteLength(values[0], "latin1") > 16384)) {
                response.destroy();
                finish(new ValidationTransportError("INVALID_RESPONSE"));
                return;
              }
              const result = { status: response.statusCode ?? 0, paymentRequired: values[0] ?? null };
              response.destroy();
              finish(undefined, result);
            });
            requestHandle.on("error", (error: NodeJS.ErrnoException) => finish(new ValidationTransportError(error.code === "HPE_HEADER_OVERFLOW" ? "INVALID_RESPONSE" : "TRANSPORT_UNAVAILABLE")));
            requestHandle.maxHeadersCount = 0;
            requestHandle.end(body);
          });
          connection.once("end", () => finish(new ValidationTransportError("INVALID_RESPONSE")));
          connection.once("close", () => finish(new ValidationTransportError("TRANSPORT_UNAVAILABLE")));
        } catch {
          resolving = false;
          finish(new ValidationTransportError(timedOut ? "TRANSPORT_TIMEOUT" : "DNS_UNAVAILABLE"));
        }
      })();
    });
  };
}
