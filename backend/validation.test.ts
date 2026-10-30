import { describe, expect, test } from "bun:test";
import { hashJSON as sha } from "./validation-codec";
import { hashDomain, hashStruct, hashTypedData, keccak256, stringToHex, type Address, type Hex } from "viem";
import fixture from "./fixtures/validation.json";
import { authorizationTypes, attestationTypes, attestationDigest, authorizationDigest, canonicalSignature } from "./validation-crypto";
import { parseValidationRequest } from "./validation-evaluator";

function hex(value: string): Hex {
  if (!/^0x[0-9a-f]*$/.test(value)) throw new Error("invalid fixture hex");
  return value as Hex;
}
function address(value: string): Address {
  if (!/^0x[0-9a-f]{40}$/.test(value)) throw new Error("invalid fixture address");
  return value as Address;
}
const domain = {
  name: fixture.authorization.domain.name,
  version: fixture.authorization.domain.version,
  chainId: BigInt(fixture.authorization.domain.chainId),
  verifyingContract: address(fixture.authorization.domain.verifyingContract),
};
const domainTypes = { EIP712Domain: [{name: "name",type: "string"},{name: "version",type: "string"},{name: "chainId",type: "uint256"},{name: "verifyingContract",type: "address"}] } as const;
const a = fixture.authorization.message;
const authorization = {
  demandId: BigInt(a.demandId), builderWallet: address(a.builderWallet), serviceUrlHash: hex(a.serviceUrlHash),
  evidenceHash: hex(a.evidenceHash), requestHash: hex(a.requestHash), paymentNetworkHash: hex(a.paymentNetworkHash),
  authorizedPayTo: address(a.authorizedPayTo), submissionNonce: BigInt(a.submissionNonce), issuedAt: BigInt(a.issuedAt), expiresAt: BigInt(a.expiresAt),
};
const t = fixture.attestation.message;
const attestation = {
  escrowChainId: BigInt(t.escrowChainId), verifyingContract: address(t.verifyingContract), demandId: BigInt(t.demandId),
  builderWallet: address(t.builderWallet), serviceUrlHash: hex(t.serviceUrlHash), evidenceHash: hex(t.evidenceHash),
  paymentRequirementsHash: hex(t.paymentRequirementsHash), submissionNonce: BigInt(t.submissionNonce),
  validationPolicyId: hex(t.validationPolicyId), issuedAt: BigInt(t.issuedAt), expiresAt: BigInt(t.expiresAt),
};
describe("published synthetic validation vectors", () => {
  test("production authorization and attestation bind every field", () => {
    const input = {schemaVersion:"unmet-x402-validation-v1",escrowChainId:fixture.authorization.domain.chainId,escrowContract:fixture.authorization.domain.verifyingContract,demandId:a.demandId,submissionNonce:a.submissionNonce,builderWallet:a.builderWallet,authorizedPayTo:a.authorizedPayTo,serviceUrl:fixture.preimages.serviceUrl,evidenceHash:a.evidenceHash,paymentNetwork:fixture.preimages.paymentNetwork,request:{method:"POST",query:[],contentType:"application/json",body:{city:"Jakarta"}},builderAuthorization:{issuedAt:a.issuedAt,expiresAt:a.expiresAt,signature:"0x12"}};
    const parsed = parseValidationRequest(Buffer.from(JSON.stringify(input)));
    expect<string>(authorizationDigest(parsed)).toBe(fixture.expected.authorizationDigest);
    for (const [field,value] of Object.entries({escrowChainId:"196",escrowContract:"0x3333333333333333333333333333333333333333",demandId:"2",builderWallet:"0x3333333333333333333333333333333333333333",authorizedPayTo:"0x3333333333333333333333333333333333333333",serviceUrl:"https://example.com/other",evidenceHash:`0x${"33".repeat(32)}`,paymentNetwork:"eip155:1",submissionNonce:"2"})) {
      const changed = parseValidationRequest(Buffer.from(JSON.stringify({...input,[field]:value})));
      expect(authorizationDigest(changed)).not.toBe(fixture.expected.authorizationDigest);
    }
    for (const field of ["issuedAt","expiresAt"] as const) {
      const changed = parseValidationRequest(Buffer.from(JSON.stringify({...input,builderAuthorization:{...input.builderAuthorization,[field]:String(BigInt(input.builderAuthorization[field])+1n)}})));
      expect(authorizationDigest(changed)).not.toBe(fixture.expected.authorizationDigest);
    }
    const changedRequest = parseValidationRequest(Buffer.from(JSON.stringify({...input,request:{...input.request,body:{city:"Bali"}}})));
    expect(authorizationDigest(changedRequest)).not.toBe(fixture.expected.authorizationDigest);
    for (const [field,value] of Object.entries({escrowChainId:"196",verifyingContract:"0x3333333333333333333333333333333333333333",demandId:"2",builderWallet:"0x3333333333333333333333333333333333333333",serviceUrlHash:`0x${"33".repeat(32)}`,evidenceHash:`0x${"33".repeat(32)}`,paymentRequirementsHash:`0x${"33".repeat(32)}`,submissionNonce:"2",validationPolicyId:`0x${"33".repeat(32)}`,issuedAt:"1",expiresAt:"2"})) expect(attestationDigest({...fixture.attestation.message,[field]:value})).not.toBe(fixture.expected.attestationDigest);
    expect(canonicalSignature(`0x${"11".repeat(64)}1d`)).toBe(false);
    expect(canonicalSignature(`0x${"11".repeat(32)}${"ff".repeat(32)}1b`)).toBe(false);
    expect(canonicalSignature("0x12")).toBe(false);
  });
  test("JCS fixture digests and mutations", () => {
    expect<string>(sha(fixture.request)).toBe(fixture.expected.requestHash);
    expect<string>(sha(fixture.payment)).toBe(fixture.expected.paymentRequirementsHash);
    expect<string>(sha(fixture.policy)).toBe(fixture.expected.validationPolicyId);
    expect(sha({...fixture.request, body: {city: "Bali"}})).not.toBe(fixture.expected.requestHash);
    expect(sha({...fixture.policy, escrowChainId: "196"})).not.toBe(fixture.expected.validationPolicyId);
    expect<string>(sha(Object.fromEntries(Object.entries(fixture.request).reverse()))).toBe(fixture.expected.requestHash);
  });
  test("EIP-712 authorization and attestation bind deployment and receiver", () => {
    const digest = hashTypedData({domain,types: authorizationTypes,primaryType: "BuilderValidationAuthorization",message: authorization});
    const typeHash = (name:string, fields:readonly {name:string;type:string}[]) => keccak256(stringToHex(`${name}(${fields.map(f => `${f.type} ${f.name}`).join(",")})`));
    expect<string>(typeHash("BuilderValidationAuthorization",authorizationTypes.BuilderValidationAuthorization)).toBe(fixture.expected.authorizationTypeHash);
    expect<string>(typeHash("ValidationAttestation",attestationTypes.ValidationAttestation)).toBe(fixture.expected.attestationTypeHash);
    expect<string>(hashStruct({primaryType:"BuilderValidationAuthorization",types:authorizationTypes,data:authorization})).toBe(fixture.expected.authorizationStructHash);
    expect<string>(hashStruct({primaryType:"ValidationAttestation",types:attestationTypes,data:attestation})).toBe(fixture.expected.attestationStructHash);
    expect(digest).toBe(hex(fixture.expected.authorizationDigest));
    expect(hashDomain({domain,types: domainTypes})).toBe(hex(fixture.expected.domainSeparator));
    expect(hashDomain({domain: {...domain,chainId: 196n},types: domainTypes})).toBe(hex(fixture.expected.mainnetDomainSeparator));
    expect(hashTypedData({domain,types: attestationTypes,primaryType: "ValidationAttestation",message: attestation})).toBe(hex(fixture.expected.attestationDigest));
    expect<string>(attestationDigest(fixture.attestation.message)).toBe(fixture.expected.attestationDigest);
    expect(hashTypedData({domain: {...domain,chainId: 196n},types: authorizationTypes,primaryType: "BuilderValidationAuthorization",message: authorization})).not.toBe(digest);
    expect(hashTypedData({domain: {...domain,verifyingContract: address("0x3333333333333333333333333333333333333333")},types: authorizationTypes,primaryType: "BuilderValidationAuthorization",message: authorization})).not.toBe(digest);
    expect(hashTypedData({domain,types: authorizationTypes,primaryType: "BuilderValidationAuthorization",message: {...authorization,authorizedPayTo: address("0x3333333333333333333333333333333333333333")}})).not.toBe(digest);
    expect(hashTypedData({domain,types: attestationTypes,primaryType: "ValidationAttestation",message: {...attestation,submissionNonce: 2n}})).not.toBe(hex(fixture.expected.attestationDigest));
    expect(keccak256(stringToHex(fixture.preimages.serviceUrl))).toBe(hex(a.serviceUrlHash));
    expect(keccak256(stringToHex(fixture.preimages.evidence))).toBe(hex(a.evidenceHash));
    expect(keccak256(stringToHex(fixture.preimages.paymentNetwork))).toBe(hex(a.paymentNetworkHash));
  });
});
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

describe("structural schemas", () => {
  const ajv = new Ajv2020({strict: true});
  const load = (name: string) => JSON.parse(readFileSync(new URL(`../docs/schemas/validation-${name}.json`, import.meta.url), "utf8"));
  const policy = load("policy");
  const request = load("request");
  const response = load("response");
  const validatePolicy = ajv.compile(policy);
  const validateRequest = ajv.compile(request);
  const validateResponse = ajv.compile(response);
  const sample = {
    schemaVersion: "unmet-x402-validation-v1", escrowChainId: "1952", escrowContract: fixture.authorization.domain.verifyingContract,
    demandId: "9007199254740993", submissionNonce: "1", builderWallet: fixture.authorization.message.builderWallet,
    authorizedPayTo: fixture.authorization.message.authorizedPayTo, serviceUrl: "https://example.com/weather",
    evidenceHash: fixture.authorization.message.evidenceHash, paymentNetwork: "eip155:196",
    request: {method: "POST",query: [],contentType: "application/json",body: {city: "Jakarta"}},
    builderAuthorization: {issuedAt: "1792886400",expiresAt: "1792887300",signature: "0x12"},
  };
  test("policy preserves exact fields and vocabulary", () => {
    expect(validatePolicy(fixture.policy)).toBe(true);
    expect(validatePolicy({...fixture.policy, extra: true})).toBe(false);
    const p = structuredClone(fixture.policy);
    p.profile.assets[0].transferMethods[0].paymentFlows = ["escrow"];
    expect(validatePolicy(p)).toBe(false);
  });
  test("request method, query and unknown-field limits", () => {
    expect(validateRequest(sample)).toBe(true);
    expect(validateRequest({...sample, headers: {Authorization: "x"}})).toBe(false);
    expect(validateRequest({...sample, request: {...sample.request,method: "GET"}})).toBe(false);
    expect(validateRequest({...sample, request: {...sample.request,query: Array.from({length: 33},()=>["a","b"])}})).toBe(false);
  });
  test("parser accepts at most 4096 signature bytes", () => {
    const request = (size: number) => Buffer.from(JSON.stringify({...sample,builderAuthorization:{...sample.builderAuthorization,signature:`0x${"12".repeat(size)}`}}));
    expect(parseValidationRequest(request(4096)).input.builderAuthorization.signature.length).toBe(8194);
    expect(() => parseValidationRequest(request(4097))).toThrow("INVALID_REQUEST");
  });
  test("policy method branches and version constraints", () => {
    const p = structuredClone(fixture.policy);
    p.profile.x402Versions = [1];
    expect(validatePolicy(p)).toBe(false);
    p.profile.x402Versions = [2];
    p.profile.assets[0].transferMethods[0].tokenDomain = null;
    expect(validatePolicy(p)).toBe(false);
    const q = structuredClone(fixture.policy);
    q.profile.assets[0].transferMethods[1].permit2Contract = null;
    expect(validatePolicy(q)).toBe(false);
    const r = structuredClone(fixture.policy);
    r.profile.assets[0].transferMethods[1].tokenDomain = { name: "wrong", version: "1" };
    expect(validatePolicy(r)).toBe(false);
  });
  test("PASS response enforces method, flow and signature v", () => {
    const result = {
      status: "PASS", profileId: fixture.policy.profile.id, selectedOffer: fixture.payment.selected,
      selectedOfferIndex: 0, requestHash: fixture.expected.requestHash,
      validationPolicyId: fixture.expected.validationPolicyId, paymentRequirementsHash: fixture.expected.paymentRequirementsHash,
      validatedAt: fixture.attestation.message.issuedAt, expiresAt: fixture.attestation.message.expiresAt,
      attestation: fixture.attestation.message, signature: "0x" + "11".repeat(64) + "1b",
    };
    expect(validateResponse(result)).toBe(true);
    expect(validateResponse({ ...result, signature: "0x" + "11".repeat(64) + "1d" })).toBe(false);
    expect(validateResponse({ ...result, selectedOffer: { ...result.selectedOffer, extra: { ...result.selectedOffer.extra, assetTransferMethod: "unknown" } } })).toBe(false);
    expect(validateResponse({ ...result, selectedOffer: { ...result.selectedOffer, extra: { ...result.selectedOffer.extra, paymentFlow: "upfront" } } })).toBe(false);
  });
  test("failure responses cannot carry attestations", () => {
    expect(validateResponse({status: "FAIL",code: "INVALID_CHALLENGE",message: "Invalid challenge",retryable: false})).toBe(true);
    expect(validateResponse({status: "FAIL",code: "INVALID_CHALLENGE",message: "Invalid challenge",retryable: false,attestation: {}})).toBe(false);
  });
});
