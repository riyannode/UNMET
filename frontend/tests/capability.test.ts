import { describe, expect, test } from "bun:test";
import { normalizeCapability } from "../capability";

describe("normalizeCapability", () => {
  test("converts spaces to hyphens and lowercases input", () => {
    expect(normalizeCapability(" Paid API For Business ")).toBe("paid-api-for-business");
  });

  test("preserves existing hyphens", () => {
    expect(normalizeCapability("paid-api-for-business")).toBe("paid-api-for-business");
  });

  test("collapses multiple spaces to one hyphen", () => {
    expect(normalizeCapability("paid   api  for business")).toBe("paid-api-for-business");
  });

  test("rejects punctuation", () => {
    expect(() => normalizeCapability("paid_api")).toThrow("DEMAND_INVALID_CAPABILITY");
  });

  test("keeps the 64 character maximum", () => {
    expect(normalizeCapability("a".repeat(64))).toBe("a".repeat(64));
    expect(() => normalizeCapability("a".repeat(65))).toThrow("DEMAND_INVALID_CAPABILITY");
  });
});
