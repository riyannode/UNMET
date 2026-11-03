import { encodeFunctionData, isAddress, type PublicClient } from "viem";
import { encodeRfqV1 } from "../shared/rfq.ts";
import type { EscrowDeployment } from "../shared/deployment.ts";
import { AGENT_DEMAND_ABI, verifyMarket } from "./contract.ts";
import { parseStrictJSON, parseUint256, type JSONValue } from "./validation-codec.ts";

type DemandInput = {
  chainId: number;
  contract: string;
  capability: string;
  specification: string;
  maxUnitPrice: bigint;
  expectedCalls: bigint;
  deadline: bigint;
  initialCommitment: bigint;
};
type InputResult = { ok: true; value: DemandInput } | { ok: false; code: string; message: string };

export function validateDemandInput(raw: Uint8Array): InputResult {
  let body: JSONValue;
  try { body = parseStrictJSON(raw); }
  catch { return { ok: false, code: "INVALID_JSON", message: "Use strict UTF-8 JSON without duplicate keys" }; }
  const fail = (code: string, message: string): InputResult => ({ ok: false, code, message });
  const fields = ["chainId", "contract", "capability", "specification", "maxUnitPrice", "expectedCalls", "deadline", "initialCommitment"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(body, key))) return fail("INVALID_REQUEST", "Provide exactly the required demand fields");
  if (typeof body.chainId !== "number" || !Number.isSafeInteger(body.chainId) || body.chainId <= 0 ||
      typeof body.contract !== "string" || !isAddress(body.contract) || /^0x0{40}$/i.test(body.contract)) {
    return fail("DEMAND_INVALID_DEPLOYMENT", "Provide the configured escrow chain and contract");
  }
  if (typeof body.capability !== "string" || body.capability.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.capability)) {
    return fail("DEMAND_INVALID_CAPABILITY", "Use a lowercase capability slug of at most 64 characters");
  }
  const spec = body.specification;
  if (!spec || typeof spec !== "object" || Array.isArray(spec) || Object.keys(spec).length !== 2 ||
      !Object.hasOwn(spec, "schemaVersion") || typeof spec.description !== "string") return fail("DEMAND_INVALID_SPEC", "Provide schemaVersion and description only");
  if (spec.schemaVersion !== "unmet-rfq-v1") return fail("DEMAND_UNSUPPORTED_SPEC_VERSION", "Use unmet-rfq-v1");
  let specification: string;
  try { specification = encodeRfqV1(spec.description); }
  catch { return fail("DEMAND_INVALID_SPEC", "Provide a nonempty description whose encoded specification fits 2,048 UTF-8 bytes"); }
  const integer = (value: unknown, bits: number, code: string): bigint => {
    if (typeof value !== "string") throw new Error(code);
    let parsed: bigint;
    try { parsed = parseUint256(value); } catch { throw new Error(code); }
    if (parsed <= 0n || parsed >= 1n << BigInt(bits)) throw new Error(code);
    return parsed;
  };
  try {
    return { ok: true, value: {
      chainId: body.chainId, contract: body.contract, capability: body.capability, specification,
      maxUnitPrice: integer(body.maxUnitPrice, 96, "DEMAND_INVALID_AMOUNT"),
      expectedCalls: integer(body.expectedCalls, 64, "DEMAND_INVALID_CALLS"),
      deadline: integer(body.deadline, 64, "DEMAND_INVALID_DEADLINE"),
      initialCommitment: integer(body.initialCommitment, 96, "DEMAND_INVALID_COMMITMENT"),
    } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "INVALID_REQUEST", "Use positive decimal integer strings within contract bounds");
  }
}

export async function prepareDemand(client: PublicClient, deployment: EscrowDeployment, input: DemandInput) {
  await verifyMarket(client, deployment);
  const block = await client.getBlock();
  const minimum = await client.readContract({ address: deployment.contract, abi: AGENT_DEMAND_ABI, functionName: "minCommitment", blockNumber: block.number });
  if (input.deadline < block.timestamp + 3600n) throw new Error("DEMAND_INVALID_DEADLINE");
  if (input.initialCommitment < minimum) throw new Error("DEMAND_INVALID_COMMITMENT");
  const data = encodeFunctionData({ abi: AGENT_DEMAND_ABI, functionName: "createDemand", args: [
    input.capability, input.specification, input.maxUnitPrice, input.expectedCalls, input.deadline, input.initialCommitment,
  ] });
  return { chainId: deployment.chainId, to: deployment.contract, data, value: "0" as const };
}
