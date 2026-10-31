import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter } from "react-router";
import { describe, expect, test } from "bun:test";
import UnmetNavigation, { RollText } from "../UnmetNavigation";
import { demandHref, parseDemandId, parseDemandRoute, ROUTES } from "../routing";

const contract = "0x1111111111111111111111111111111111111111";

const routeObjects = Object.entries(ROUTES).flatMap(([id, route]) =>
  "path" in route ? [{ id, path: route.path }] : [],
);

describe("app routes", () => {
  test.each([
    ["/", "landing"],
    ["/market", "market"],
    [`/market/1952/${contract}/42`, "demandDetail"],
    ["/create-demand", "createDemand"],
    ["/analytics", "analytics"],
  ])("matches %s to %s", (path, routeId) => {
    expect(matchRoutes(routeObjects, path)?.at(-1)?.route.id).toBe(routeId);
  });

  test("keeps public documentation outside the React app routes", () => {
    expect(ROUTES.docs.href).toBe("/docs");
    expect("path" in ROUTES.docs).toBe(false);
    expect(matchRoutes(routeObjects, "/docs")).toBeNull();
  });

  test("renders Docs as a native link while app links stay client-side", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UnmetNavigation)));
    const docsAnchor = markup.match(/<a\b[^>]*href="\/docs"[^>]*>/)?.[0];
    const marketAnchor = markup.match(/<a\b[^>]*href="\/market"[^>]*>/)?.[0];
    const analyticsAnchor = markup.match(/<a\b[^>]*href="\/analytics"[^>]*>/)?.[0];

    expect(docsAnchor).toBeDefined();
    expect(docsAnchor).not.toContain("data-discover");
    expect(marketAnchor).toContain("data-discover");
    expect(analyticsAnchor).toContain("data-discover");
  });

  test("exposes one readable label while hiding both animated layers", () => {
    const markup = renderToStaticMarkup(createElement(RollText, { text: "Explore Market" }));
    expect(markup).toContain('<span class="unmet-roll-accessible">Explore Market</span>');
    expect(markup.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(markup).not.toContain("aria-label=");
  });

  test("docs uses the original navigation component with document navigation", () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/docs"] },
      createElement(UnmetNavigation, { documentNavigation: true })));
    for (const href of ["/", "/market", "/analytics", "/#how-it-works", "/docs", "/create-demand"]) {
      expect(markup).toContain(`href="${href}"`);
    }
    expect(markup).toContain('class="unmet-nav"');
    expect(markup).toContain('aria-label="Open navigation"');
  });

  test("builds demand URLs that can be opened directly", () => {
    expect(demandHref(1952, contract, 42n)).toBe(`/market/1952/${contract}/42`);
    expect(parseDemandRoute("1952", contract, "42")).toEqual({ chainId: 1952, contract, demandId: 42n });
    expect(parseDemandRoute("0", contract, "42")).toBeNull();
    expect(parseDemandRoute("1952", `0x${"0".repeat(40)}`, "42")).toBeNull();
    expect(parseDemandRoute("1952", contract, "0")).toBeNull();
  });

  test("does not register the removed activity route", () => {
    expect(matchRoutes(routeObjects, "/my-activity")).toBeNull();
  });

  test.each([
    ["42", 42n],
    ["1", 1n],
  ])("parses demand id %s", (value, demandId) => {
    expect(parseDemandId(value)).toBe(demandId);
  });

  test.each([undefined, "", "0", "01", "garbage", "-2", (1n << 256n).toString()])(
    "rejects invalid demand id %s",
    (value) => {
      expect(parseDemandId(value)).toBeNull();
    },
  );
});

test("approved proposal describes settlement and cancelled refund eligibility", () => {
  const script = `
    import { mock } from "bun:test";
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { strict as assert } from "node:assert";
    mock.module("./Analytics.tsx", () => ({ AnalyticsDashboard: () => null }));
    const tabs = { ...await import("./components/ui/tabs.tsx") };
    mock.module("./components/ui/tabs.tsx", () => ({
      ...tabs, TabsContent: props => createElement(tabs.TabsContent, { ...props, keepMounted: true }),
    }));
    const { DemandDetail } = await import("./App.tsx");
    const address = "0x1111111111111111111111111111111111111111";
    const now = BigInt(Math.floor(Date.now() / 1000));
    const demand = { demandId: 1n, submissionNonce: 1n, creator: address, builder: address, maxUnitPrice: 1n, committed: 50_000n, reviewCommitted: 50_000n, approvalRequired: 30_000n, expectedCalls: 1n, deadline: now + 86400n, reviewEndsAt: now + 3600n, supporterCount: 1, status: 1, capability: "example", specification: "example", serviceUrl: "https://example.test", evidenceHash: "0x" + "0".repeat(64), approvalWeight: 50_000n, quorumReached: true, rejectionWeight: 0n, rejectionThreshold: 20_001n, candidateRejected: false };
    const support = { commitment: 50_000n, expectedCalls: 1n, approved: true, rejected: false, refundable: false };
    const render = (status, refundable, commitment = 50_000n) => renderToStaticMarkup(createElement(DemandDetail, {
      demand: { ...demand, status }, support: { ...support, refundable, commitment }, supportState: "ready",
      account: address, busy: false, close: () => {}, closeLabel: "Close", run: async () => { throw new Error("unexpected transaction"); }, blockedActionIds: [],
    }));
    const active = render(1, false);
    assert.match(active, /Approved \u00b7 commitment eligible for settlement/);
    assert.doesNotMatch(active, /Settlement cancelled/);
    const cancelled = render(4, true);
    assert.doesNotMatch(cancelled, /Approved \u00b7 commitment eligible for settlement/);
    assert.match(cancelled, /Settlement cancelled \u00b7 remaining commitment refundable/);
    assert.doesNotMatch(render(4, false, 0n), /remaining commitment refundable/);
  `;
  const result = Bun.spawnSync([process.execPath, "-e", script], { cwd: "frontend", stdout: "pipe", stderr: "pipe", timeout: 30_000 });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
