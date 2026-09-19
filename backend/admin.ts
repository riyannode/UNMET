/** Operational CLI. No admin HTTP routes. */
import { createPublicClient, createWalletClient, defineChain, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_DEMAND_ABI, loadConfig } from "./contract.ts";

const MVP = {
  feeBps: 200,
  quorumBps: 6000,
  minCommitment: 10_000n,
  reviewPeriod: 24 * 60 * 60,
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function chainFor(network: "testnet" | "mainnet", rpc: string) {
  return defineChain({
    id: network === "mainnet" ? 196 : 1952,
    name: network === "mainnet" ? "X Layer" : "X Layer Testnet",
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

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

async function readDeploymentAfterReceipt(
  client: ReturnType<typeof createPublicClient>,
  contract: Address,
  hash: `0x${string}`,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await readDeployment(client, contract);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Deployment receipt succeeded but contract readback is unavailable: ${hash}`, { cause: lastError });
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

async function deploy(network: "testnet" | "mainnet") {
  const privateKey = required("DEPLOYER_PRIVATE_KEY") as `0x${string}`;
  const treasury = getAddress(required("UNMET_TREASURY"));
  const token = getAddress(process.env.PAYMENT_TOKEN || (network === "mainnet"
    ? "0x779ded0c9e1022225f8e0630b35a9b54be713736"
    : "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c"));
  const rpc = process.env.XLAYER_RPC_URL || (network === "mainnet"
    ? "https://rpc.xlayer.tech"
    : "https://testrpc.xlayer.tech/terigon");
  const chain = chainFor(network, rpc);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpc, { timeout: 15_000, retryCount: 2 }) });
  const walletClient = createWalletClient({ account, chain, transport: http(rpc, { timeout: 15_000, retryCount: 2 }) });
  const connectedChainId = await publicClient.getChainId();
  const expectedChainId = network === "testnet" ? 1952 : 196;
  if (connectedChainId !== chain.id || connectedChainId !== expectedChainId) {
    throw new Error(`Refusing ${network} deployment: expected chain ${expectedChainId}, got ${connectedChainId}`);
  }

  const artifactPath = join(import.meta.dir, "out", "AgentDemand.sol", "AgentDemand.json");
  let bytecode: `0x${string}`;
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { bytecode: { object: string } };
    const raw = artifact.bytecode.object;
    if (!raw) throw new Error("empty bytecode");
    bytecode = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  } catch (error) {
    throw new Error(`Foundry artifact missing/invalid at ${artifactPath}. Run: forge build --root backend. ${String(error)}`);
  }

  console.log(JSON.stringify({
    action: "deploy",
    network,
    account: account.address,
    token,
    treasury,
    ...MVP,
    minCommitment: MVP.minCommitment.toString(),
  }, null, 2));
  const hash = await walletClient.deployContract({
    abi: AGENT_DEMAND_ABI,
    bytecode,
    args: [token, treasury, MVP.feeBps, MVP.quorumBps, MVP.minCommitment, MVP.reviewPeriod],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`);
  console.log(JSON.stringify({
    status: "receipt_success",
    deployTx: hash,
    contractAddress: receipt.contractAddress,
    blockNumber: receipt.blockNumber.toString(),
  }, null, 2));

  const deployment = await readDeploymentAfterReceipt(publicClient, receipt.contractAddress, hash);
  if (String(deployment.token).toLowerCase() !== token.toLowerCase()) throw new Error("Token readback mismatch");
  if (String(deployment.treasury).toLowerCase() !== treasury.toLowerCase()) throw new Error("Treasury readback mismatch");
  if (deployment.feeBps !== MVP.feeBps || deployment.quorumBps !== MVP.quorumBps) throw new Error("Economic config readback mismatch");

  console.log(JSON.stringify({
    status: "success",
    deployTx: hash,
    contractAddress: receipt.contractAddress,
    blockNumber: receipt.blockNumber.toString(),
    chainId: await publicClient.getChainId(),
    readback: deployment,
  }, null, 2));
}

const command = process.argv[2] || "inspect";
if (command === "inspect") await inspect();
else if (command === "deploy-testnet") await deploy("testnet");
else if (command === "deploy-mainnet") {
  if (process.env.ALLOW_MAINNET_DEPLOY !== "1") throw new Error("Set ALLOW_MAINNET_DEPLOY=1 only after verified testnet E2E");
  await deploy("mainnet");
} else throw new Error(`Unknown command: ${command}`);
