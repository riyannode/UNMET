import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/validation.json";
import { evaluateChallenge, parseValidationRequest } from "./validation-evaluator";
import type { PolicyEnvelope } from "./validation-config";

const sample = {
  schemaVersion: "unmet-x402-validation-v1", escrowChainId: "1952", escrowContract: fixture.policy.escrowContract,
  demandId: "9007199254740993", submissionNonce: "1", builderWallet: fixture.authorization.message.builderWallet,
  authorizedPayTo: fixture.authorization.message.authorizedPayTo, serviceUrl: "https://example.com/weather",
  evidenceHash: fixture.authorization.message.evidenceHash, paymentNetwork: "eip155:196",
  request: { method: "POST", query: [] as string[][], contentType: "application/json", body: { city: "Jakarta" } },
  builderAuthorization: { issuedAt: "1792886400", expiresAt: "1792887300", signature: "0x12" },
};
const parse = (v: unknown = sample) => parseValidationRequest(Buffer.from(JSON.stringify(v)));
const offer = fixture.payment.selected;
const policy = fixture.policy as PolicyEnvelope;
const run = (accepts: unknown[], resource: unknown = fixture.payment.resource, p = policy, max = 10000n, decimals = 6) => evaluateChallenge(parse(), {
  status: 402, paymentRequired: Buffer.from(JSON.stringify({ x402Version: 2, resource, accepts })).toString("base64"),
}, p, max, decimals);

describe("validation evaluator", () => {
  test("published request and selected-offer digests", () => {
    expect<string>(parse().requestHash).toBe(fixture.expected.requestHash);
    expect<string>(run([offer]).paymentRequirementsHash).toBe(fixture.expected.paymentRequirementsHash);
    expect<string>(run([offer]).validationPolicyId).toBe(fixture.expected.validationPolicyId);
    const omitted = { ...offer, extra: { assetTransferMethod: "eip3009", name: "USD₮0", version: "1" } };
    expect<string>(run([omitted]).paymentRequirementsHash).toBe(fixture.expected.paymentRequirementsHash);
  });
  test("all offers validated before first eligible is chosen", () => {
    expect(() => run([offer, { ...offer, amount: "1.2" }])).toThrow();
    expect(() => run([{ ...offer, extra: null }, offer])).toThrow();
    const unsupported = { ...offer, network: "solana:main_net", asset: "token", payTo: "wallet" };
    expect(run([unsupported, offer]).selectedOfferIndex).toBe(1);
    expect(run([{ ...unsupported, amount: (2n ** 256n).toString(), maxTimeoutSeconds: 1.5 }, offer]).selectedOfferIndex).toBe(1);
    expect(run([{ ...offer, amount: (2n ** 256n).toString() }, offer]).selectedOfferIndex).toBe(1);
    expect(run([{ ...offer, maxTimeoutSeconds: 1.5 }, offer]).selectedOfferIndex).toBe(1);
    expect(() => run([{ ...unsupported, amount: "1.5" }, offer])).toThrow("INVALID_CHALLENGE");
    expect(run([offer, offer]).selectedOfferIndex).toBe(0);
  });
  test("flow, method, domain, receiver, timeout and amount determine eligibility", () => {
    for (const changed of [
      { ...offer, extra: { ...offer.extra, paymentFlow: null } },
      { ...offer, extra: { ...offer.extra, paymentFlow: "upfront" } },
      { ...offer, extra: { ...offer.extra, assetTransferMethod: "unknown" } },
      { ...offer, extra: { ...offer.extra, name: "wrong" } },
      { ...offer, payTo: "0x0000000000000000000000000000000000000002" },
      { ...offer, maxTimeoutSeconds: 301 }, { ...offer, amount: "10001" },
    ]) expect(() => run([changed])).toThrow();
    expect(run([offer], fixture.payment.resource, policy, 10000n).eligible).toBe(true);
    expect(() => run([offer], fixture.payment.resource, policy, 10000n, 18)).toThrow("UNSUPPORTED_PRICE_COMPARISON");
  });
  test("price diagnostics distinguish relevant incomparable and comparable offers", () => {
    const otherAsset = { ...offer, asset: "0x0000000000000000000000000000000000000002" };
    const wrongReceiver = { ...offer, payTo: "0x0000000000000000000000000000000000000002" };
    const otherNetwork = { ...offer, network: "eip155:1" };
    expect(() => run([wrongReceiver, otherAsset])).toThrow("NO_ELIGIBLE_OFFER");
    expect(() => run([otherAsset, wrongReceiver])).toThrow("NO_ELIGIBLE_OFFER");
    expect(() => run([wrongReceiver])).toThrow("NO_ELIGIBLE_OFFER");
    expect(() => run([otherAsset])).toThrow("UNSUPPORTED_PRICE_COMPARISON");
    for (const incompatible of [otherNetwork, { ...otherAsset, network: "eip155:1" }]) {
      expect(() => run([incompatible])).toThrow("UNSUPPORTED_PRICE_COMPARISON");
      expect(() => run([wrongReceiver, incompatible])).toThrow("NO_ELIGIBLE_OFFER");
      expect(() => run([incompatible, wrongReceiver])).toThrow("NO_ELIGIBLE_OFFER");
      expect(run([incompatible, offer]).selectedOfferIndex).toBe(1);
    }
    const selected = run([otherAsset, offer]);
    expect(selected.selectedOfferIndex).toBe(1);
    expect<string>(selected.paymentRequirementsHash).toBe(fixture.expected.paymentRequirementsHash);
    expect<string>(selected.validationPolicyId).toBe(fixture.expected.validationPolicyId);
    for (const irrelevant of [{ ...otherAsset, scheme: "unknown" }, { ...otherAsset, network: "solana:main_net" }, { ...offer, network: "solana:main_net", asset: "token", payTo: "wallet" }]) {
      expect(() => run([irrelevant])).toThrow("NO_ELIGIBLE_OFFER");
    }
  });
  test("resource binds origin, path, query and preserves metadata", () => {
    expect(run([offer], { url: "/weather", description: "Weather" }).paymentRequirementsHash).not.toBe(fixture.expected.paymentRequirementsHash);
    for (const url of ["", "  ", "https://other.example/weather", "/other", "/weather?a=1", "https://user@example.com/weather", "https://@example.com/weather", "//@example.com/weather", "/weather#x"]) expect(() => run([offer], { url })).toThrow();
    const pathRequest = parse({ ...sample, serviceUrl: "https://example.com/a@b" });
    const observation = { status: 402, paymentRequired: Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "/a@b" }, accepts: [offer] })).toString("base64") };
    expect(evaluateChallenge(pathRequest, observation, policy, 10000n, 6).eligible).toBe(true);
    const queryRequest = parse({ ...sample, request: { ...sample.request, query: [["q", "a@b"]] } });
    const queryObservation = { status: 402, paymentRequired: Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "/weather?q=a%40b" }, accepts: [offer] })).toString("base64") };
    expect(evaluateChallenge(queryRequest, queryObservation, policy, 10000n, 6).eligible).toBe(true);
  });
  test("request enforces 443, method rules and ordered queries", () => {
    expect<string>(parse({ ...sample, serviceUrl: "https://example.com:443/weather" }).requestHash).toBe(fixture.expected.requestHash);
    expect(() => parse({ ...sample, serviceUrl: "https://example.com:8443/weather" })).toThrow();
    expect(() => parse({ ...sample, request: { ...sample.request, method: "GET" } })).toThrow();
    const pairs = Array.from({ length: 32 }, (_, i) => ["a", String(i)]);
    expect(parse({ ...sample, request: { ...sample.request, query: pairs } }).requestUrl).toContain("a=0&a=1");
    expect(() => parse({ ...sample, request: { ...sample.request, query: [...pairs, ["a", "33"]] } })).toThrow();
  });
  test("strict wire base64 and endpoint status", () => {
    for (const header of ["@@@", "Zh==", "e30==", "e30=\n"]) expect(() => evaluateChallenge(parse(), { status: 402, paymentRequired: header }, policy, 10000n, 6)).toThrow();
    expect(() => evaluateChallenge(parse(), { status: 500, paymentRequired: null }, policy, 10000n, 6)).toThrow("ENDPOINT_UNAVAILABLE");
    expect(() => evaluateChallenge(parse(), { status: 429, paymentRequired: null }, policy, 10000n, 6)).toThrow("INVALID_CHALLENGE");
    expect(() => evaluateChallenge(parse(), { status: 408, paymentRequired: null }, policy, 10000n, 6)).toThrow("INVALID_CHALLENGE");
    const wire = Buffer.from(JSON.stringify({ x402Version: 2, resource: fixture.payment.resource, accepts: [offer] })).toString("base64");
    expect(evaluateChallenge(parse(), { status: 402, paymentRequired: wire.replace(/=+$/, "") }, policy, 10000n, 6).eligible).toBe(true);
    expect(evaluateChallenge(parse(), { status: 402, paymentRequired: wire }, policy, 10000n, 6).eligible).toBe(true);
  });
  test("method defaults and explicit permit2 require reviewed configuration", () => {
    const noMethod = { ...offer, extra: { name: "USD₮0", version: "1", paymentFlow: "authorization" } };
    expect(() => run([noMethod])).toThrow();
    const defaultPolicy = structuredClone(policy);
    defaultPolicy.profile.assets[0].defaultTransferMethod = "eip3009";
    expect(run([noMethod], fixture.payment.resource, defaultPolicy).eligible).toBe(true);
    const permit = { ...offer, extra: { assetTransferMethod: "permit2", paymentFlow: "authorization" } };
    expect(run([permit]).eligible).toBe(true);
    const disabled = structuredClone(policy);
    disabled.profile.assets[0].transferMethods[1].enabled = false;
    expect(() => run([permit], fixture.payment.resource, disabled)).toThrow();
    expect(() => run([{ ...permit, extra: { assetTransferMethod: "permit2" } }])).toThrow();
  });
  test("strict input, uint256 boundaries and no stablecoin parity", () => {
    expect(() => parseValidationRequest(Buffer.from('{"schemaVersion":1,"schemaVersion":1}'))).toThrow();
    expect(() => parseValidationRequest(Buffer.from([0xff]))).toThrow();
    const unknownField = { ...sample, unknown: true };
    expect(() => parse(unknownField)).toThrow();
    const max = (2n ** 256n - 1n).toString();
    expect(run([{ ...offer, amount: max }], fixture.payment.resource, policy, BigInt(max)).eligible).toBe(true);
    expect(run([{ ...offer, amount: "0" }], fixture.payment.resource, policy, 0n).eligible).toBe(true);
    expect(() => run([{ ...offer, amount: (2n ** 256n).toString() }])).toThrow();
    expect(() => run([{ ...offer, asset: "0x0000000000000000000000000000000000000002" }])).toThrow("UNSUPPORTED_PRICE_COMPARISON");
  });
  test("canonical URL, time widths, policy identity and metadata", () => {
    expect(parse({ ...sample, serviceUrl: "https://example.com" }).input.serviceUrl).toBe("https://example.com/");
    expect(() => parse({ ...sample, serviceUrl: "https://EXAMPLE.com/weather" })).toThrow();
    expect(() => parse({ ...sample, builderAuthorization: { ...sample.builderAuthorization, issuedAt: (2n ** 64n).toString() } })).toThrow();
    const wrongPolicy = structuredClone(policy);
    wrongPolicy.profile.network = "eip155:1";
    expect(() => run([offer], fixture.payment.resource, wrongPolicy)).toThrow("INVALID_POLICY");
    expect(() => run([offer], { url: "/weather", serviceName: "" })).toThrow();
    expect(() => run([offer], { url: "/weather", tags: [""] })).toThrow();
    expect(() => parse({ ...sample, serviceUrl: `https://example.com/${"a".repeat(493)}` })).toThrow();
    expect(() => parse({ ...sample, request: { ...sample.request, query: [["q", "x".repeat(2048)]] } })).toThrow();
  });
  test("boundary lengths, nested unknown fields, and disabled policy entries", () => {
    const prefix = "https://example.com/";
    expect(parse({ ...sample, serviceUrl: prefix + "a".repeat(512 - prefix.length) }).input.serviceUrl.length).toBe(512);
    expect(() => parse({ ...sample, serviceUrl: prefix + "a".repeat(513 - prefix.length) })).toThrow();
    const queryPrefix = sample.serviceUrl.length + 3;
    expect(parse({ ...sample, request: { ...sample.request, query: [["q", "x".repeat(2048 - queryPrefix)]] } }).requestUrl.length).toBe(2048);
    expect(() => parse({ ...sample, request: { ...sample.request, query: [["q", "x".repeat(2049 - queryPrefix)]] } })).toThrow();
    const nested = { ...sample, request: { ...sample.request, headers: {} } };
    expect(() => parse(nested)).toThrow();
    const disabledProfile = structuredClone(policy);
    disabledProfile.profile.enabled = false;
    expect(() => run([offer], fixture.payment.resource, disabledProfile)).toThrow();
    const disabledAsset = structuredClone(policy);
    disabledAsset.profile.assets[0].enabled = false;
    expect(() => run([offer], fixture.payment.resource, disabledAsset)).toThrow();
    const noFlow = structuredClone(policy);
    noFlow.profile.assets[0].transferMethods[0].defaultPaymentFlow = null;
    expect(() => run([{ ...offer, extra: { assetTransferMethod: "eip3009", name: "USD₮0", version: "1" } }], fixture.payment.resource, noFlow)).toThrow();
    for (const flow of ["escrow", "unknown"]) expect(() => run([{ ...offer, extra: { ...offer.extra, paymentFlow: flow } }])).toThrow();
  });
  test("complete raw request byte limit and challenge metadata types", () => {
    const raw = JSON.stringify(sample);
    expect<string>(parseValidationRequest(Buffer.from(raw + " ".repeat(32768 - Buffer.byteLength(raw)))).requestHash).toBe(fixture.expected.requestHash);
    expect(() => parseValidationRequest(Buffer.from(raw + " ".repeat(32769 - Buffer.byteLength(raw))))).toThrow("INVALID_REQUEST");
    for (const resource of [{ url: "/weather", description: null }, { url: "/weather", tags: [null] }, { url: "/weather", iconUrl: null }]) expect(() => run([offer], resource)).toThrow("INVALID_CHALLENGE");
    for (const extension of [null, {}, { info: null, schema: {} }, { info: {}, schema: null }]) {
      const header = Buffer.from(JSON.stringify({ x402Version: 2, resource: fixture.payment.resource, accepts: [offer], extensions: { test: extension } })).toString("base64");
      expect(() => evaluateChallenge(parse(), { status: 402, paymentRequired: header }, policy, 10000n, 6)).toThrow("INVALID_CHALLENGE");
    }
  });
  test("required x402 envelope, response and offer types", () => {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
    const envelope = { x402Version: 2, resource: fixture.payment.resource, accepts: [offer] };
    for (const value of [{ ...envelope, x402Version: 1 }, { ...envelope, resource: undefined }, { ...envelope, accepts: [] }]) {
      expect(() => evaluateChallenge(parse(), { status: 402, paymentRequired: encoded(value) }, policy, 10000n, 6)).toThrow("INVALID_CHALLENGE");
    }
    for (const observation of [{ status: 402, paymentRequired: null }, { status: 200, paymentRequired: encoded(envelope) }, { status: 302, paymentRequired: encoded(envelope) }]) {
      expect(() => evaluateChallenge(parse(), observation, policy, 10000n, 6)).toThrow("INVALID_CHALLENGE");
    }
    for (const malformed of [{ ...offer, amount: 10000 }, { ...offer, network: null }, { ...offer, maxTimeoutSeconds: "60" }]) {
      expect(() => run([malformed, offer])).toThrow("INVALID_CHALLENGE");
      expect(() => run([offer, malformed])).toThrow("INVALID_CHALLENGE");
    }
  });
  test("GET with null content type and body is accepted", () => {
    const get = parse({ ...sample, request: { method: "GET", query: [], contentType: null, body: null } });
    expect(get.input.request.method).toBe("GET");
    expect(get.postBody).toBeNull();
    expect(get.requestUrl).toBe(sample.serviceUrl);
  });
});
