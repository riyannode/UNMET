import { createServer } from "node:http";
import { chmodSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http } from "viem";
import { AGENT_DEMAND_ABI } from "../shared/abi.ts";
import { loadDiscoveryConfig } from "./discovery-config.ts";
import { discoveryRequest, evaluateDiscovery } from "./discovery-evaluator.ts";
import { parseDiscoveryMetadata, verifyDiscoverySignature } from "./discovery-metadata.ts";
import { parseObserverPolicyConfig } from "./validation-config.ts";
import { createValidationTransport } from "./validation-transport.ts";

const decimalsAbi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;

export async function prepareObserverSocket(path: string) {
  let file;
  try { file = lstatSync(path); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!file.isSocket() || file.uid !== process.getuid?.()) throw new Error("DISCOVERY_SOCKET_UNAVAILABLE");
  const stale = await new Promise<boolean>((resolve) => {
    const connection = connect(path);
    connection.setTimeout(1000, () => { connection.destroy(); resolve(false); });
    connection.once("connect", () => { connection.destroy(); resolve(false); });
    connection.once("error", (error: NodeJS.ErrnoException) => resolve(error.code === "ECONNREFUSED"));
  });
  const current = lstatSync(path);
  if (!stale || !current.isSocket() || current.ino !== file.ino || current.uid !== file.uid) throw new Error("DISCOVERY_SOCKET_UNAVAILABLE");
  unlinkSync(path);
}

export async function startDiscoveryObserver() {
  const policyPath = process.env.DISCOVERY_POLICY_PATH;
  const socket = process.env.DISCOVERY_SOCKET_PATH;
  if (!policyPath || !socket || !socket.startsWith("/")) throw new Error("DISCOVERY_INVALID_CONFIG");
  const policy = parseObserverPolicyConfig(readFileSync(policyPath));
  const config = loadDiscoveryConfig(process.env.DISCOVERY_CONFIG_PATH);
  const verifiedAssets = new Set<string>();
  for (const deployment of policy.deployments) for (const profile of deployment.paymentProfiles) {
    if (!profile.enabled) continue;
    const client = createPublicClient({ transport: http(profile.paymentRpcUrl, { timeout: config.timeoutMs, retryCount: 0 }) });
    if (String(await client.getChainId()) !== profile.network.slice(7)) throw new Error("DISCOVERY_INVALID_POLICY");
    for (const asset of profile.assets) {
      if (!asset.enabled) continue;
      const address = asset.asset as `0x${string}`;
      if (!await client.getCode({ address }) || await client.readContract({ address, abi: decimalsAbi, functionName: "decimals" }) !== asset.decimals) throw new Error("DISCOVERY_INVALID_POLICY");
      verifiedAssets.add(`${profile.network}:${asset.asset}`);
    }
  }
  const inspect = createValidationTransport({ managementAddresses: policy.managementAddresses, timeoutMs: config.timeoutMs });
  let active = 0;
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === "GET" && req.url === "/health") { res.writeHead(200).end(); return; }
      if (req.method !== "POST" || req.url !== "/observe" || active >= config.maxInFlight) { res.writeHead(503).end(); return; }
      active++;
      req.setTimeout(config.timeoutMs, () => req.destroy());
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new Error("DISCOVERY_INVALID_METADATA"); chunks.push(chunk); }
        const metadata = parseDiscoveryMetadata(Buffer.concat(chunks));
        const deployment = policy.deployments.find((item) => item.escrowChainId === metadata.chainId && item.escrowContract === metadata.contract);
        if (!deployment) throw new Error("DISCOVERY_INVALID_POLICY");
        const client = createPublicClient({ transport: http(deployment.escrowRpcUrl, { timeout: config.timeoutMs, retryCount: 0 }) });
        if (String(await client.getChainId()) !== metadata.chainId) throw new Error("DISCOVERY_INVALID_POLICY");
        const block = await client.getBlock();
        if (!block.hash) throw new Error("DISCOVERY_UNAVAILABLE");
        const result = await client.request({ method: "eth_call", params: [{ to: metadata.contract, data: encodeFunctionData({ abi: AGENT_DEMAND_ABI, functionName: "getDemand", args: [BigInt(metadata.demandId)] }) }, { blockHash: block.hash, requireCanonical: true }] });
        if (!result) throw new Error("DISCOVERY_UNAVAILABLE");
        const demand = decodeFunctionResult({ abi: AGENT_DEMAND_ABI, functionName: "getDemand", data: result });
        if (demand.status !== 2 || demand.builder.toLowerCase() !== metadata.builder || demand.serviceUrl !== metadata.serviceUrl || demand.evidenceHash.toLowerCase() !== metadata.evidenceHash || !await verifyDiscoverySignature(client, metadata, block.hash)) throw new Error("DISCOVERY_INVALID_METADATA");
        const request = discoveryRequest(metadata);
        const observation = await inspect(new URL(metadata.serviceUrl).href, { method: metadata.request.method, query: metadata.request.query, contentType: metadata.request.contentType, body: request.body });
        const evaluation = evaluateDiscovery(metadata, observation, deployment, verifiedAssets, demand.maxUnitPrice);
        if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error("DISCOVERY_UNAVAILABLE");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: evaluation.offers.length ? "compatible" : "incompatible", reason: evaluation.offers.length ? null : "NO_COMPATIBLE_OFFERS", metadataRevision: metadata.revision, ...evaluation, blockHash: block.hash }));
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        const state = code === "DISCOVERY_INVALID_METADATA" ? "metadata_invalid" : ["DISCOVERY_INCOMPATIBLE", "DISCOVERY_INVALID_CHALLENGE", "INVALID_CHALLENGE", "INVALID_RESOURCE"].includes(code) ? "incompatible" : "unavailable";
        const reason = state === "metadata_invalid" ? "INVALID_METADATA" : state === "incompatible" ? "INVALID_CHALLENGE" : "PROVIDER_OR_RPC_UNAVAILABLE";
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state, reason, offers: [] }));
      }
      finally { active--; }
    })();
  });
  await prepareObserverSocket(socket);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, () => { server.off("error", reject); resolve(); }); });
  chmodSync(socket, 0o660);
  const socketInode = lstatSync(socket).ino;
  const stop = () => {
    const deadline = setTimeout(() => { server.closeAllConnections(); }, config.timeoutMs + 5000);
    deadline.unref();
    server.close(() => {
      clearTimeout(deadline);
      try { const file = lstatSync(socket); if (file.isSocket() && file.ino === socketInode && file.uid === process.getuid?.()) unlinkSync(socket); } catch { /* The socket may already be gone. */ }
    });
    server.closeIdleConnections();
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  return server;
}

if (import.meta.main) {
  try { await startDiscoveryObserver(); }
  catch { console.error("DISCOVERY_STARTUP_UNAVAILABLE"); process.exitCode = 1; }
}
