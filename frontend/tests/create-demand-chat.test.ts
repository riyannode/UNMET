import { describe, expect, test } from "bun:test";
import { normalizeCapability } from "../capability";
import {
  buildReviewRows,
  canContinueCreateDemandWorkflow,
  deadlineDurationSeconds,
  formatPriceUsage,
  parseCapabilityAnswer,
  parseCommitmentAnswer,
  parseDeadlineAnswer,
  parseExpectedCallsAnswer,
  parseMaximumPriceAnswer,
  parsePriceUsageAnswer,
  parseSpecificationAnswer,
  resolveUniqueCreatedDemandId,
  updateEditedAnswer,
  type CreateDemandAnswers,
  type DemandReadbackMatch,
} from "../create-demand-chat-model";

const completeAnswers: CreateDemandAnswers = {
  capability: "vendor-kyb-api",
  capabilityLabel: "Vendor KYB API",
  specification: "Verify business registration, ownership and status. Return JSON.",
  maxPrice: "0.02",
  expectedCalls: "1000",
  commitment: "20",
  deadlineDays: "14",
};

describe("Create Demand wallet gate", () => {
  test("requires a connected wallet and blocks while disconnect is pending", () => {
    const account = "0x1111111111111111111111111111111111111111";

    expect(canContinueCreateDemandWorkflow(null, false)).toBe(false);
    expect(canContinueCreateDemandWorkflow(account, true)).toBe(false);
    expect(canContinueCreateDemandWorkflow(account, false)).toBe(true);
  });
});

describe("guided demand answers", () => {
  test("normalizes capabilities and preserves the validation boundaries", () => {
    expect(normalizeCapability(" Paid API For Business ")).toBe("paid-api-for-business");
    expect(normalizeCapability("paid-api-for-business")).toBe("paid-api-for-business");
    expect(normalizeCapability("paid   api  for business")).toBe("paid-api-for-business");
    expect(() => normalizeCapability("paid_api")).toThrow("DEMAND_INVALID_CAPABILITY");
    expect(normalizeCapability("a".repeat(64))).toBe("a".repeat(64));
    expect(() => normalizeCapability("a".repeat(65))).toThrow("DEMAND_INVALID_CAPABILITY");
  });

  test("normalizes a readable capability while retaining its label", () => {
    expect(parseCapabilityAnswer(" Vendor KYB API ")).toEqual({
      capability: "vendor-kyb-api",
      label: "Vendor KYB API",
    });
  });

  test("validates specification by UTF-8 byte length", () => {
    expect(parseSpecificationAnswer("🧪".repeat(512))).toBe("🧪".repeat(512));
    expect(() => parseSpecificationAnswer("🧪".repeat(513))).toThrow("2,048 UTF-8 bytes");
    expect(() => parseSpecificationAnswer("   ")).toThrow("Enter a service specification");
  });

  test("does not infer expected calls from a price denominator", () => {
    expect(parsePriceUsageAnswer("$20 per 1,000 calls")).toEqual({
      kind: "missing",
      field: "expectedCalls",
      maxPrice: "0.02",
    });
  });

  test("parses only explicitly stated expected usage and exact unit pricing", () => {
    expect(parsePriceUsageAnswer("$20 per 1,000 calls; expect 1,000 calls")).toEqual({
      kind: "complete",
      maxPrice: "0.02",
      expectedCalls: "1000",
    });
    expect(parsePriceUsageAnswer("0.02 USD₮0 per call; expect 1,000 calls total")).toEqual({
      kind: "complete",
      maxPrice: "0.02",
      expectedCalls: "1000",
    });
  });

  test("validates the Step 3 price and total call fields separately", () => {
    expect(parseMaximumPriceAnswer("0.02")).toBe("0.02");
    expect(() => parseMaximumPriceAnswer("")).toThrow("greater than zero");
    expect(() => parseMaximumPriceAnswer("0.0000001")).toThrow("6 decimal places");
    expect(parseExpectedCallsAnswer("1000")).toBe("1000");
    expect(() => parseExpectedCallsAnswer("")).toThrow("positive whole number");
    expect(() => parseExpectedCallsAnswer("1.5")).toThrow("positive whole number");
    expect(() => parseExpectedCallsAnswer("0")).toThrow("positive whole number");
    expect(formatPriceUsage("0.02", "1000")).toBe("0.02 USD₮0 per call; 1,000 calls total");
  });

  test("asks for a missing maximum price when usage is explicit", () => {
    expect(parsePriceUsageAnswer("expect 1000 calls")).toEqual({
      kind: "missing",
      field: "maxPrice",
      expectedCalls: "1000",
    });
  });

  test("rejects unsupported or non-exact prices instead of rounding", () => {
    expect(() => parsePriceUsageAnswer("around twenty dollars")).toThrow("maximum price per call");
    expect(() => parsePriceUsageAnswer("0.0000001 per call; expect 3 calls")).toThrow("6 decimal places");
    expect(() => parsePriceUsageAnswer("$1 per 3 calls; expect 3 calls")).toThrow("exact USD₮0 unit price");
  });

  test("validates positive escrow amounts and existing deadline bounds", () => {
    expect(parseCommitmentAnswer("20 USD₮0")).toBe("20");
    expect(() => parseCommitmentAnswer("0")).toThrow("greater than zero");
    expect(() => parseCommitmentAnswer("1.0000001")).toThrow("6 decimal places");
    expect(parseDeadlineAnswer("14 days")).toBe("14");
    expect(parseDeadlineAnswer("0.5")).toBe("0.5");
    expect(() => parseDeadlineAnswer("0.041655 days")).toThrow("at least one hour");
    expect(parseDeadlineAnswer("0.041666666666666664")).toBe("0.041666666666666664");
    expect(parseDeadlineAnswer("0.04167824074074075")).toBe("0.04167824074074075");
    expect(() => deadlineDurationSeconds("0.041655")).toThrow("DEMAND_DEADLINE_TOO_SHORT");
    expect(deadlineDurationSeconds("0.041666666666666664")).toBe(3600);
    expect(deadlineDurationSeconds("0.04167824074074075")).toBe(3601);
    expect(() => parseDeadlineAnswer("-1")).toThrow("greater than zero");
    expect(() => parseDeadlineAnswer("3651 days")).toThrow("3,650 days");
  });

  test("rejects expected calls outside the contract uint64 range", () => {
    expect(() => parsePriceUsageAnswer("0.02 per call; expected calls: 18446744073709551616"))
      .toThrow("positive whole number");
  });

  test("revalidates edits and preserves the previous draft after an invalid edit", () => {
    const invalid = updateEditedAnswer(completeAnswers, "expectedCalls", "0");
    expect(invalid.kind).toBe("invalid");
    expect(completeAnswers.expectedCalls).toBe("1000");
    expect(updateEditedAnswer(completeAnswers, "expectedCalls", "1,200 calls")).toEqual({
      kind: "valid",
      answers: { ...completeAnswers, expectedCalls: "1200" },
    });

    expect(updateEditedAnswer(completeAnswers, "capability", "Merchant Risk API")).toEqual({
      kind: "valid",
      answers: { ...completeAnswers, capability: "merchant-risk-api", capabilityLabel: "Merchant Risk API" },
    });
  });

  test("renders all six canonical review fields in contract order", () => {
    const rows = buildReviewRows(completeAnswers, Date.UTC(2026, 9, 22));
    expect(rows.map((row) => row.label)).toEqual([
      "Service",
      "Specification",
      "Max price",
      "Expected usage",
      "Initial escrow",
      "Deadline",
    ]);
    expect(rows[0]?.value).toBe("Vendor KYB API");
    expect(rows[0]?.detail).toBe("Canonical capability: vendor-kyb-api");
    expect(rows[2]?.value).toBe("0.02 USD₮0 per call");
    expect(rows[3]?.value).toBe("1,000 calls");
    expect(rows[4]?.value).toBe("20 USD₮0");
    expect(rows[5]?.detail).toContain("estimate");
  });
});

describe("created demand readback matching", () => {
  const expected = {
    creator: "0x1111111111111111111111111111111111111111",
    capability: "vendor-kyb-api",
    specification: completeAnswers.specification,
    maxPrice: 20_000n,
    expectedCalls: 1000n,
    initialCommitment: 20_000_000n,
  };

  function demand(demandId: bigint, changes: Partial<DemandReadbackMatch> = {}): DemandReadbackMatch {
    return {
      demandId,
      creator: expected.creator,
      capability: expected.capability,
      specification: expected.specification,
      maxUnitPrice: expected.maxPrice,
      expectedCalls: expected.expectedCalls,
      committed: expected.initialCommitment,
      ...changes,
    };
  }

  test("returns a detail id only for one new exact matching demand", () => {
    expect(resolveUniqueCreatedDemandId(
      [demand(1n)],
      [demand(1n), demand(2n)],
      expected,
    )).toBe(2n);
  });

  test("does not guess when the readback is ambiguous or only contains old matches", () => {
    expect(resolveUniqueCreatedDemandId(
      [demand(1n)],
      [demand(1n), demand(2n), demand(3n)],
      expected,
    )).toBeNull();
    expect(resolveUniqueCreatedDemandId([demand(1n)], [demand(1n)], expected)).toBeNull();
  });

  test("does not match another creator or a changed contract term", () => {
    expect(resolveUniqueCreatedDemandId(
      [],
      [
        demand(1n, { creator: "0x2222222222222222222222222222222222222222" }),
        demand(2n, { maxUnitPrice: 30_000n }),
      ],
      expected,
    )).toBeNull();
  });
});
