/** Operational CLI. No admin HTTP routes. */
import { createPublicClient, http, type Address } from "viem";
import { AGENT_DEMAND_ABI, loadConfig } from "./contract.ts";

async function readDeployment(client: ReturnType<typeof createPublicClient>, contract: Address) {
  const [token, treasury, feeBps, quorumBps, minCommitment, reviewPeriod, nextDemandId, totalEscrowed, bytecode] = await Promise.all([
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "token" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "treasury" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "feeBps" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "quorumBps" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "minCommitment" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "reviewPeriod" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "nextDemandId" }),
    client.readContract({ address: contract, abi: AGENT_DEMAND_ABI, functionName: "totalEscrowed" }),
    client.getBytecode({ address: contract }),
  ]);
  if (!bytecode || bytecode === "0x") throw new Error("No contract bytecode at DEMAND_CONTRACT");
  return {
    token,
    treasury,
    feeBps: Number(feeBps),
    quorumBps: Number(quorumBps),
    minCommitment: minCommitment.toString(),
    reviewPeriod: Number(reviewPeriod),
    nextDemandId: nextDemandId.toString(),
    totalEscrowed: totalEscrowed.toString(),
    bytecodeBytes: (bytecode.length - 2) / 2,
  };
}

async function inspect() {
  const cfg = loadConfig();
  if (!cfg.contract) throw new Error("DEMAND_CONTRACT not set");
  const client = createPublicClient({ transport: http(cfg.rpcUrl, { timeout: 15_000, retryCount: 2 }) });
  const [block, deployment] = await Promise.all([
    client.getBlockNumber(),
    readDeployment(client, cfg.contract),
  ]);
  console.log(JSON.stringify({
    chainId: cfg.chainId,
    rpc: cfg.rpcUrl,
    contract: cfg.contract,
    deployBlock: cfg.deployBlock.toString(),
    latestBlock: block.toString(),
    ...deployment,
  }, null, 2));
}

const command = process.argv[2] || "inspect";
if (command === "inspect") await inspect();
else if (command === "deploy-testnet" || command === "deploy-mainnet") {
  throw new Error("DEPLOYMENT_TOOLING_UNAVAILABLE: canonical AgentDemand deployment is deferred to G0.5");
} else throw new Error(`Unknown command: ${command}`);
