import { describe, expect, test } from "bun:test";
import { isoFromUnix } from "./contract.ts";
import { app, createApp, scoreOpportunity, validateOpportunitiesInput } from "./server.ts";

describe("Vercel Express entrypoint", () => {
  test("exports an Express app and mounts payment middleware only on the paid route", async () => {
    expect(typeof app).toBe("function");
    let middlewareCalls = 0;
    const server = createApp({
      middleware: (_req, res) => {
        middlewareCalls += 1;
        res.status(402).end();
      },
    }).listen(0, "127.0.0.1");

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/opportunities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(402);
      expect(middlewareCalls).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});

describe("opportunity score", () => {
  test("is deterministic and bounded", () => {
    const now = 1_700_000_000n;
    const pool = [
      { committed: 100n, expectedCalls: 10n, supporters: 1, deadlineUnix: now + 86_400n },
      { committed: 360n, expectedCalls: 25_000n, supporters: 37, deadlineUnix: now + 86_400n * 20n },
      { committed: 50n, expectedCalls: 5n, supporters: 2, deadlineUnix: now + 86_400n * 2n },
    ];
    const first = scoreOpportunity(pool[1]!, pool, now);
    const second = scoreOpportunity(pool[1]!, pool, now);
    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  test("keeps bigint precision above Number.MAX_SAFE_INTEGER", () => {
    const now = 1_700_000_000n;
    const pool = [
      { committed: 9_007_199_254_740_993n, expectedCalls: 9_007_199_254_740_993n, supporters: 2, deadlineUnix: now + 86_400n },
      { committed: 9_007_199_254_740_994n, expectedCalls: 9_007_199_254_740_994n, supporters: 2, deadlineUnix: now + 86_400n },
    ];
    expect(scoreOpportunity(pool[1]!, pool, now)).toBeGreaterThan(scoreOpportunity(pool[0]!, pool, now));
  });
});

describe("Unix deadline serialization", () => {
  test("formats representable timestamps without a lossy seconds conversion", () => {
    expect(isoFromUnix(1_700_000_000n)).toBe("2023-11-14T22:13:20.000Z");
  });

  test("returns null for uint64 deadlines outside JavaScript Date range", () => {
    expect(isoFromUnix((1n << 64n) - 1n)).toBeNull();
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
