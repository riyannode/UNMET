import { expect, test } from "bun:test";
import fixture from "./fixtures/validation.json";
import { evaluateDiscovery } from "./discovery-evaluator.ts";
import { parseDiscoveryMetadata } from "./discovery-metadata.ts";
import { parseObserverPolicyConfig } from "./validation-config.ts";

test("current compatibility is independent of the historical maximum and uses all authorized offers", () => {
  const deployment = parseObserverPolicyConfig(Buffer.from(JSON.stringify({ managementAddresses: [], deployments: [{
    escrowChainId: fixture.policy.escrowChainId, escrowContract: fixture.policy.escrowContract, escrowRpcUrl: "https://rpc.example/",
    demandPriceAsset: fixture.policy.demandPriceAsset, paymentProfiles: [{ ...fixture.policy.profile, paymentRpcUrl: "https://payment.example/" }],
  }] }))).deployments[0];
  const offer = fixture.payment.selected;
  const metadata = parseDiscoveryMetadata(Buffer.from(JSON.stringify({ schemaVersion: "unmet-discovery-v1", chainId: fixture.policy.escrowChainId,
    contract: fixture.policy.escrowContract, demandId: "1", builder: fixture.authorization.message.builderWallet,
    serviceUrl: "https://example.com/weather", evidenceHash: fixture.authorization.message.evidenceHash, revision: "1", issuedAt: "1",
    request: { method: "POST", query: [], contentType: "application/json", body: { city: "Jakarta" } },
    targets: [{ network: offer.network, asset: offer.asset, payTo: offer.payTo }], signature: "0x12" })));
  const wire = (accepts: unknown[]) => ({ status: 402, paymentRequired: Buffer.from(JSON.stringify({ x402Version: 2, resource: fixture.payment.resource, accepts })).toString("base64") });
  const verified = new Set([`${offer.network}:${offer.asset}`]);
  const result = evaluateDiscovery(metadata, wire([offer, { ...offer, amount: "1" }]), deployment, verified, 9999n);
  expect(result.offers).toHaveLength(2);
  expect(result.offers.map((item) => item.withinOriginatingMaxPrice).sort()).toEqual([false, true]);
  expect(result.offers[0].extra).toHaveProperty("assetTransferMethod");
  expect(evaluateDiscovery(metadata, wire([offer]), deployment, new Set(), 10000n).offers).toHaveLength(0);
  for (const rejected of [
    { ...offer, network: "eip155:999" },
    { ...offer, asset: `0x${"ee".repeat(20)}` },
    { ...offer, payTo: `0x${"ff".repeat(20)}` },
    { ...offer, extra: { ...offer.extra, assetTransferMethod: "unsupported" } },
  ]) expect(evaluateDiscovery(metadata, wire([rejected]), deployment, verified, 10000n).offers).toEqual([]);
  const changed = { ...deployment, demandPriceAsset: { ...deployment.demandPriceAsset, network: "eip155:1" } };
  expect(evaluateDiscovery(metadata, wire([offer]), changed, verified, 10000n).offers[0].withinOriginatingMaxPrice).toBeNull();
  expect(() => evaluateDiscovery(metadata, wire([offer, { ...offer, amount: "1.5" }]), deployment, verified, 10000n)).toThrow("INVALID_CHALLENGE");
  const secondProfile = { ...structuredClone(deployment.paymentProfiles[0]), network: "eip155:8453" };
  const secondTarget = { ...metadata.targets[0], network: "eip155:8453" };
  const multi = { ...metadata, targets: [...metadata.targets, secondTarget] };
  const permit = { ...offer, network: "eip155:8453", extra: { assetTransferMethod: "permit2", paymentFlow: "authorization" } };
  const multiDeployment = { ...deployment, paymentProfiles: [...deployment.paymentProfiles, secondProfile] };
  const multiVerified = new Set([...verified, `${permit.network}:${permit.asset}`]);
  const misconfiguredDenomination = { ...multiDeployment, demandPriceAsset: { ...multiDeployment.demandPriceAsset, network: permit.network, asset: permit.asset } };
  expect(evaluateDiscovery(multi, wire([permit]), misconfiguredDenomination, multiVerified, 10000n).offers[0].withinOriginatingMaxPrice).toBeNull();
  const observed = evaluateDiscovery(multi, wire([permit, offer, { ...offer, payTo: `0x${"ff".repeat(20)}` }, { ...permit, extra: { ...permit.extra, paymentFlow: "upfront" } }]), multiDeployment, multiVerified, 10000n);
  expect(observed.offers).toHaveLength(2);
  expect(observed.offers.map((item) => item.transferMethod).sort()).toEqual(["eip3009", "permit2"]);
  expect(observed.offers.find((item) => item.network === permit.network)?.withinOriginatingMaxPrice).toBeNull();
  expect(evaluateDiscovery(multi, wire([permit, offer]), multiDeployment, multiVerified, 10000n).offers).toEqual(evaluateDiscovery(multi, wire([offer, permit]), multiDeployment, multiVerified, 10000n).offers);
  expect(() => evaluateDiscovery(metadata, { status: 500, paymentRequired: null }, deployment, verified, 10000n)).toThrow("DISCOVERY_PROVIDER_UNAVAILABLE");
});
