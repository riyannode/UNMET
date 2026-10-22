import { describe, expect, test } from "bun:test";
import { errorMessage } from "../errors";

describe("errorMessage", () => {
  test("preserves useful messages from non-Error RPC rejections", () => {
    expect(errorMessage({ shortMessage: "RPC request failed", message: "underlying RPC rejection" })).toBe("RPC request failed");
    expect(errorMessage("RPC offline")).toBe("RPC offline");
    expect(errorMessage({ shortMessage: "  ", message: "RPC rejected" })).toBe("RPC rejected");
  });

  test("keeps stable application error codes and capability guidance", () => {
    expect(errorMessage(new Error("WALLET_NOT_CONNECTED"))).toBe("WALLET_NOT_CONNECTED");
    expect(errorMessage(new Error("DEMAND_INVALID_CAPABILITY"))).toBe("Use letters and numbers separated by spaces or hyphens, with no punctuation (64 characters max).");
  });

  test("uses INTERNAL_ERROR only when an unknown rejection has no message", () => {
    expect(errorMessage({ code: -1 })).toBe("INTERNAL_ERROR (-1)");
    expect(errorMessage(null)).toBe("INTERNAL_ERROR");
  });
});
