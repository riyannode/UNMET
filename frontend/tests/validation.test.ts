import { describe, expect, test } from "bun:test";
import { hashTypedData, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { attestationTypes } from "../../shared/validation-types";
import fixture from "../../backend/fixtures/validation.json";
import { authorization, parseRequestMetadata, requestHash, validatePass, type ValidationInput } from "../validation";

const input: ValidationInput = {
  chainId: Number(fixture.authorization.domain.chainId), contract: fixture.authorization.domain.verifyingContract as Address,
  demandId: BigInt(fixture.authorization.message.demandId), builder: fixture.authorization.message.builderWallet as Address,
  payTo: fixture.authorization.message.authorizedPayTo as Address, serviceUrl: fixture.preimages.serviceUrl,
  evidenceHash: fixture.authorization.message.evidenceHash as Hex, network: fixture.preimages.paymentNetwork,
  nonce: BigInt(fixture.authorization.message.submissionNonce), request: { method: "POST", query: [], contentType: "application/json", body: { city: "Jakarta" } },
};
describe("browser validation primitives", () => {
  test("match published JCS and authorization vectors", () => {
    expect(requestHash(input.serviceUrl, input.request)).toBe(fixture.expected.requestHash);
    expect(hashTypedData(authorization(input, BigInt(fixture.authorization.message.issuedAt), BigInt(fixture.authorization.message.expiresAt)))).toBe(fixture.expected.authorizationDigest);
  });
  test("reject unsafe JSON and duplicate keys before signing", () => {
    expect(() => parseRequestMetadata("POST", "[]", '{"a":1,"a":2}')).toThrow();
    expect(() => parseRequestMetadata("POST", "[]", '{"a":9007199254740993}')).toThrow();
    expect(() => parseRequestMetadata("GET", '[["a"]]', "{}")).toThrow();
  });
  test("reject failure and malformed PASS responses", async () => {
    await expect(validatePass({ status: "FAIL" }, input, input.contract, 1n, 2n)).rejects.toThrow();
    await expect(validatePass({ status: "PASS" }, input, input.contract, 1n, 2n)).rejects.toThrow();
  });
  test("accepts a signed bound PASS and rejects changed bindings", async () => {
    const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
    const time = 1792886400n;
    const attestation = { escrowChainId: String(input.chainId), verifyingContract: input.contract, demandId: String(input.demandId), builderWallet: input.builder, serviceUrlHash: keccak256(stringToHex(input.serviceUrl)), evidenceHash: input.evidenceHash, paymentRequirementsHash: fixture.expected.paymentRequirementsHash, submissionNonce: String(input.nonce), validationPolicyId: fixture.expected.validationPolicyId, issuedAt: String(time), expiresAt: String(time + 120n) };
    const message = { ...attestation, escrowChainId: BigInt(attestation.escrowChainId), demandId: BigInt(attestation.demandId), submissionNonce: BigInt(attestation.submissionNonce), issuedAt: time, expiresAt: time + 120n };
    const signature = await signer.signTypedData({ domain: { name: "UNMET AgentDemand", version: "2", chainId: input.chainId, verifyingContract: input.contract }, types: attestationTypes, primaryType: "ValidationAttestation", message });
    const pass = { status: "PASS", profileId: "test", selectedOffer: fixture.payment.selected, selectedOfferIndex: 0, requestHash: fixture.expected.requestHash, validationPolicyId: attestation.validationPolicyId, paymentRequirementsHash: attestation.paymentRequirementsHash, validatedAt: attestation.issuedAt, expiresAt: attestation.expiresAt, attestation, signature };
    await expect(validatePass(pass, input, signer.address, time, time + 300n)).resolves.toBeDefined();
    for (const [key, value] of Object.entries({ escrowChainId: "196", verifyingContract: "0x3333333333333333333333333333333333333333", demandId: "2", builderWallet: "0x3333333333333333333333333333333333333333", submissionNonce: "2", serviceUrlHash: `0x${"33".repeat(32)}`, evidenceHash: `0x${"33".repeat(32)}` })) {
      await expect(validatePass({ ...pass, attestation: { ...attestation, [key]: value } }, input, signer.address, time, time + 300n)).rejects.toThrow();
    }
    await expect(validatePass({ ...pass, requestHash: `0x${"33".repeat(32)}` }, input, signer.address, time, time + 300n)).rejects.toThrow();
    await expect(validatePass(pass, input, signer.address, time + 120n, time + 300n)).rejects.toThrow();
    await expect(validatePass(pass, input, signer.address, time, time + 119n)).rejects.toThrow();
    await expect(validatePass(pass, input, input.contract, time, time + 300n)).rejects.toThrow();
  });
});
