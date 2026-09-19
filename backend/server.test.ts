import { describe, expect, test } from "bun:test";
import { scoreOpportunity, validateOpportunitiesInput } from "./server.ts";

describe("opportunity score", () => {
  test("is deterministic and bounded", () => {
    const now = 1_700_000_000;
    const pool = [
      { committed: 100n, expectedCalls: 10n, supporters: 1, deadlineUnix: now + 86400 },
      { committed: 360n, expectedCalls: 25_000n, supporters: 37, deadlineUnix: now + 86400 * 20 },
      { committed: 50n, expectedCalls: 5n, supporters: 2, deadlineUnix: now + 86400 * 2 },
    ];
    const first = scoreOpportunity(pool[1]!, pool, now);
    const second = scoreOpportunity(pool[1]!, pool, now);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  test("keeps bigint precision above Number.MAX_SAFE_INTEGER", () => {
    const now = 1_700_000_000;
    const pool = [
      { committed: 9_007_199_254_740_993n, expectedCalls: 9_007_199_254_740_993n, supporters: 2, deadlineUnix: now + 86400 },
      { committed: 9_007_199_254_740_994n, expectedCalls: 9_007_199_254_740_994n, supporters: 2, deadlineUnix: now + 86400 },
    ];
    expect(scoreOpportunity(pool[1]!, pool, now)).toBeGreaterThan(scoreOpportunity(pool[0]!, pool, now));
  });
});

describe("opportunity request validation", () => {
  test("accepts the documented default request", () => {
    const result = validateOpportunitiesInput({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.limit).toBe(10);
      expect(result.value.sort).toBe("bounty");
      expect(result.value.minBounty).toBe(0n);
    }
  });

  test("rejects out-of-range limit", () => {
    const result = validateOpportunitiesInput({ limit: 51 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LIMIT");
  });

  test("rejects unknown status and sort", () => {
    const status = validateOpportunitiesInput({ status: "pending" });
    const sort = validateOpportunitiesInput({ sort: "random" });
    expect(status.ok).toBe(false);
    expect(sort.ok).toBe(false);
  });

  test("parses six-decimal bounty exactly", () => {
    const result = validateOpportunitiesInput({ minBounty: "123.456789" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minBounty).toBe(123_456_789n);
  });
});
