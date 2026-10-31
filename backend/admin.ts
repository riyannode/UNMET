/** Read-only operational CLI. */
import { AGENT_DEMAND_ABI, getPublicClient, loadConfig, verifyMarket } from "./contract.ts";
import { deploymentPlan } from "./deployment-plan.ts";

const command = process.argv[2] || "inspect";
if (command === "deploy-testnet" || command === "deploy-mainnet") throw new Error("DEPLOYMENT_TOOLING_UNAVAILABLE: AgentDemand deployment broadcast requires separate owner authorization");
if (command === "plan") {
  const plan = deploymentPlan(process.env);
  console.log(JSON.stringify(plan, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
} else if (command === "inspect") {
  const plan = deploymentPlan(process.env);
  const deployment = loadConfig().deployment;
  if (!deployment) throw new Error("CONFIG_INVALID: ESCROW_DEPLOYMENT");
  const client = getPublicClient(deployment);
  await verifyMarket(client, deployment);
  for (const name of ["treasury", "feeBps", "quorumBps", "minCommitment", "reviewPeriod", "verifier", "verifierAdmin"] as const) {
    const actual = await client.readContract({ address: deployment.contract, abi: AGENT_DEMAND_ABI, functionName: name });
    if (String(actual).toLowerCase() !== String(plan[name]).toLowerCase()) throw new Error(`DEPLOYMENT_PARAMETER_MISMATCH: ${name}`);
  }
  const [latestBlock, nextDemandId, totalEscrowed, bytecode] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: deployment.contract, abi: AGENT_DEMAND_ABI, functionName: "nextDemandId" }),
    client.readContract({ address: deployment.contract, abi: AGENT_DEMAND_ABI, functionName: "totalEscrowed" }),
    client.getBytecode({ address: deployment.contract }),
  ]);
  console.log(JSON.stringify({ chainId: deployment.chainId, contract: deployment.contract, deployBlock: deployment.deployBlock.toString(), latestBlock: latestBlock.toString(), nextDemandId: nextDemandId.toString(), totalEscrowed: totalEscrowed.toString(), bytecodeBytes: bytecode ? (bytecode.length - 2) / 2 : 0, verified: true }));
} else throw new Error(`Unknown command: ${command}`);
