import { expect, test } from "bun:test";
import fixture from "./fixtures/validation.json";
import { parseValidationConfig, resolvePolicy, validationPolicyId } from "./validation-config";

const input = () => ({ maxInFlight: 2, managementAddresses: [], deployments: [{ escrowChainId: fixture.policy.escrowChainId, escrowContract: fixture.policy.escrowContract, escrowRpcUrl: "https://rpc.example/", demandPriceAsset: fixture.policy.demandPriceAsset, paymentProfiles: [{ ...structuredClone(fixture.policy.profile), paymentRpcUrl: "https://payment.example/" }] }] });
const parse = (value: unknown) => parseValidationConfig(new TextEncoder().encode(JSON.stringify(value)));
test("explicit deployment resolves only its exact enabled profile and hashes public fields", () => {
  const config = parse(input());
  const resolved = resolvePolicy(config, fixture.policy.escrowChainId, fixture.policy.escrowContract, fixture.policy.profile.network);
  expect(resolved).toBeDefined();
  if (!resolved) throw new Error("missing policy");
  expect<string>(validationPolicyId(resolved.policy)).toBe(fixture.expected.validationPolicyId);
  const changed = input(); changed.maxInFlight = 7; changed.deployments[0].escrowRpcUrl = "https://other.example/"; changed.deployments[0].paymentProfiles[0].paymentRpcUrl = "https://other-payment.example/";
  const other = resolvePolicy(parse(changed), fixture.policy.escrowChainId, fixture.policy.escrowContract, fixture.policy.profile.network);
  expect(other && validationPolicyId(other.policy)).toBe(validationPolicyId(resolved.policy));
  expect(resolvePolicy(config, "196", fixture.policy.escrowContract, fixture.policy.profile.network)).toBeUndefined();
  const disabled = input(); disabled.deployments[0].paymentProfiles[0].enabled = false;
  expect(resolvePolicy(parse(disabled), fixture.policy.escrowChainId, fixture.policy.escrowContract, fixture.policy.profile.network)).toBeUndefined();
});
test("rejects ambiguous identities, unsorted sets and invalid defaults", () => {
  const duplicate = input(); duplicate.deployments.push(structuredClone(duplicate.deployments[0]));
  expect(() => parse(duplicate)).toThrow();
  const sameDeployment = input(); sameDeployment.deployments[0].paymentProfiles.push(structuredClone(sameDeployment.deployments[0].paymentProfiles[0]));
  expect(() => parse(sameDeployment)).toThrow();
  const duplicateAsset = input(); duplicateAsset.deployments[0].paymentProfiles[0].assets.push(structuredClone(duplicateAsset.deployments[0].paymentProfiles[0].assets[0]));
  expect(() => parse(duplicateAsset)).toThrow();
  const unsorted = input(); unsorted.deployments[0].paymentProfiles[0].assets[0].transferMethods.reverse();
  expect(() => parse(unsorted)).toThrow();
  const duplicateMethod = input(); duplicateMethod.deployments[0].paymentProfiles[0].assets[0].transferMethods.push(structuredClone(duplicateMethod.deployments[0].paymentProfiles[0].assets[0].transferMethods[0]));
  expect(() => parse(duplicateMethod)).toThrow();
  const badIp = { ...input(), managementAddresses: ["example.com"] };
  expect(() => parse(badIp)).toThrow();
  const wrongDefault = JSON.stringify(input()).replace('"defaultTransferMethod":null', '"defaultTransferMethod":"unknown"');
  expect(() => parseValidationConfig(new TextEncoder().encode(wrongDefault))).toThrow();
});
test("requires bounded concurrency, exact keys and explicit valid defaults", () => {
  const raw = JSON.stringify(input());
  for (const invalid of [
    raw.replace('"maxInFlight":2,', ''), raw.replace('"maxInFlight":2', '"maxInFlight":0'),
    raw.replace('"maxInFlight":2', '"maxInFlight":1.5'), raw.replace('"maxInFlight":2', '"maxInFlight":1025'),
    raw.replace('"maxInFlight":2', '"maxInFlight":2,"unknown":true'),
    raw.replace('"paymentRpcUrl":', '"unknown":true,"paymentRpcUrl":'),
    raw.replace('"defaultPaymentFlow":"authorization",', ''),
    raw.replace('"defaultPaymentFlow":"authorization"', '"defaultPaymentFlow":"upfront"'),
    raw.replace('"tokenDomain":null,', ''),
  ]) expect(() => parseValidationConfig(new TextEncoder().encode(invalid))).toThrow();
});
