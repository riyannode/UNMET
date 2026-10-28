import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { matchRoutes, MemoryRouter } from "react-router";
import { describe, expect, test } from "bun:test";
import UnmetNavigation, { RollText } from "../UnmetNavigation";
import { demandHref, parseDemandId, ROUTES } from "../routing";

const routeObjects = Object.entries(ROUTES).flatMap(([id, route]) =>
  "path" in route ? [{ id, path: route.path }] : [],
);

describe("app routes", () => {
  test.each([
    ["/", "landing"],
    ["/market", "market"],
    ["/market/42", "demandDetail"],
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
    expect(demandHref(42n)).toBe("/market/42");
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
