import { matchRoutes } from "react-router";
import { describe, expect, test } from "bun:test";
import { demandHref, parseDemandId, ROUTES } from "../routing";

const routeObjects = Object.entries(ROUTES).map(([id, route]) => ({
  id,
  path: route.href,
}));

describe("app routes", () => {
  test.each([
    ["/", "landing"],
    ["/docs", "docs"],
    ["/market", "market"],
    ["/market/42", "demandDetail"],
    ["/create-demand", "createDemand"],
    ["/my-activity", "myActivity"],
  ])("matches %s to %s", (path, routeId) => {
    expect(matchRoutes(routeObjects, path)?.at(-1)?.route.id).toBe(routeId);
  });

  test("builds demand URLs that can be opened directly", () => {
    expect(demandHref(42n)).toBe("/market/42");
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
