import { describe, expect, mock, test } from "bun:test";
import { createMagicRingsFrameBudget } from "../magic-rings-frame-budget";

function setup() {
  let clock = 0;
  const posted: number[] = [];
  const close = mock(() => {});
  const exceeded = mock(() => {});
  const channel: NonNullable<Parameters<typeof createMagicRingsFrameBudget>[1]> = {
    port1: { onmessage: null, close },
    port2: { postMessage: (ticket) => posted.push(ticket), close },
  };
  const budget = createMagicRingsFrameBudget(exceeded, channel, () => clock);

  function frame(at: number) {
    clock = at;
    budget.frame();
  }

  function deliver(at: number, ticket = posted.shift()) {
    if (ticket === undefined) throw new Error("No sample queued");
    clock = at;
    channel.port1.onmessage?.(new MessageEvent("message", { data: ticket }));
  }

  function stalledFrames(from: number, through: number) {
    for (let at = from; at <= through; at += 100) {
      frame(at);
      deliver(at + 24);
      frame(at + 25);
    }
  }

  return { budget, frame, deliver, stalledFrames, exceeded, close, posted };
}

describe("MagicRings frame budget", () => {
  test("starts after draw-anchored warmup and catches sustained sub-50 ms stalls", () => {
    const h = setup();
    h.frame(1000);
    h.frame(1499);
    expect(h.posted).toEqual([]);
    h.stalledFrames(1500, 2000);
    expect(h.exceeded).not.toHaveBeenCalled();
    h.stalledFrames(2100, 2100);
    expect(h.exceeded).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(2);
    h.frame(2700);
    expect(h.posted).toEqual([]);
  });

  test("keeps slow cadence with large idle gaps and an isolated stall animated", () => {
    const h = setup();
    h.frame(0);
    h.frame(500);
    h.deliver(720);
    h.frame(750);
    h.deliver(752);

    for (let at = 950; at <= 1750; at += 200) {
      h.frame(at);
      h.deliver(at + 2);
    }
    h.frame(1950);
    expect(h.exceeded).not.toHaveBeenCalled();
    h.budget.dispose();
  });

  test("finishes samples when the posted task is delivered after the next frame", () => {
    const h = setup();
    h.frame(0);
    for (let at = 500; at <= 1100; at += 100) {
      h.frame(at);
      h.frame(at + 25);
      h.deliver(at + 26);
    }
    expect(h.exceeded).toHaveBeenCalledTimes(1);
  });

  test("discards a prior streak and stale messages on lifecycle reset", () => {
    const h = setup();
    h.frame(0);
    h.stalledFrames(500, 800);
    h.frame(900);
    const stale = h.posted.shift();
    expect(stale).toBeDefined();
    h.budget.reset();
    h.frame(3000);
    h.frame(3500);
    h.deliver(3501, stale);
    expect(h.posted).toHaveLength(1);
    h.deliver(3524);
    h.frame(3525);
    h.stalledFrames(3600, 3700);
    expect(h.exceeded).not.toHaveBeenCalled();
    h.budget.dispose();
  });

  test("disposes an in-flight sample and remounts with clean timing", () => {
    const h = setup();
    h.frame(0);
    h.frame(500);
    h.budget.dispose();
    h.deliver(777);
    h.budget.dispose();
    expect(h.close).toHaveBeenCalledTimes(2);
    expect(h.exceeded).not.toHaveBeenCalled();
    const remount = setup();
    remount.frame(1234);
    remount.frame(1733);
    expect(remount.posted).toEqual([]);
    remount.budget.dispose();
  });
});
