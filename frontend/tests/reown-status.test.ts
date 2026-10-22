import { describe, expect, test } from "bun:test";
import { reownButtonLabel, resolveReownStatus } from "../reown-status";

describe("Reown initialization state", () => {
  test("distinguishes configured but not-yet-loaded AppKit from unavailable Reown", () => {
    const status = resolveReownStatus(true, false, false);
    expect(status).toBe("initializing");
    expect(reownButtonLabel(status)).toBe("Initializing Reown…");
  });

  test("reports unavailable only without configuration or after load failure", () => {
    expect(resolveReownStatus(false, false, false)).toBe("unavailable");
    expect(resolveReownStatus(true, true, false)).toBe("unavailable");
    expect(reownButtonLabel("unavailable")).toBe("Reown Unavailable");
  });

  test("uses the connect or account label only when AppKit is ready", () => {
    const status = resolveReownStatus(true, true, true);
    expect(status).toBe("ready");
    expect(reownButtonLabel(status)).toBe("Connect wallet");
    expect(reownButtonLabel(status, "0x1234…abcd")).toBe("0x1234…abcd");
  });
});
