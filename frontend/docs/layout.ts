import type { Plugin } from "vite";

export const docsGroups: readonly { title: string; items: readonly (readonly [string, string])[] }[] = [
  { title: "Overview", items: [
    ["Introduction", "/docs"],
    ["How UNMET works", "/docs#how-it-works"],
    ["Current capabilities", "/docs#capabilities"],
  ] },
  { title: "Getting Started", items: [
    ["For requesters", "/docs/getting-started/"],
    ["For builders", "/docs/getting-started/builders/"],
    ["For AI agents", "/docs/getting-started/agents/"],
  ] },
  { title: "Demand Market", items: [
    ["Creating & funding demand", "/docs/demand-market/"],
    ["Builder proposals", "/docs/demand-market/proposals/"],
    ["Review & fulfillment", "/docs/demand-market/review/"],
    ["Refunds", "/docs/demand-market/refunds/"],
  ] },
  { title: "API & Integrations", items: [
    ["API overview", "/docs/api/"],
    ["Free demand API", "/docs/api/#free-demand-api"],
    ["Demand Intelligence API", "/docs/api/intelligence/"],
    ["x402 payments", "/docs/api/payments/"],
    ["Supported networks & assets", "/docs/api/payments/#networks-and-assets"],
    ["Errors & recovery", "/docs/api/errors/"],
  ] },
  { title: "Future Implementation", items: [
    ["Roadmap overview", "/docs/roadmap/"],
    ["Automatic x402 validation", "/docs/roadmap/#automatic-validation"],
    ["Machine-readable RFQ", "/docs/roadmap/#rfq"],
    ["Service Registry", "/docs/roadmap/#service-registry"],
    ["x402 Service Discovery", "/docs/roadmap/#service-discovery"],
    ["Intelligence Expansion", "/docs/roadmap/#intelligence-expansion"],
    ["Capability Resolver", "/docs/roadmap/#capability-resolver"],
  ] },
];

export const docsRoutes = [...new Set(docsGroups.flatMap((group) => group.items.map(([, href]) => href.split("#")[0]!)))];
export const docsFile = (route: string) => route === "/docs" ? "docs/index.html" : route.slice(1) + "index.html";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export function docsLayout(html: string, filename: string): string {
  const route = docsRoutes.find((route) => filename.replaceAll("\\", "/").endsWith("/" + docsFile(route)));
  if (!route) return html;
  const group = docsGroups.find((group) => group.items.some(([, href]) => href.split("#")[0] === route))!;
  const sidebar = docsGroups.map((group) => {
    const active = group.items.some(([, href]) => href.split("#")[0] === route);
    const links = group.items.map(([title, href]) =>
      `<li><a href="${href}"${href === route ? ' aria-current="page"' : ""}>${escape(title)}</a></li>`).join("");
    return `<details${active ? ' open data-active-group' : ""}><summary>${group.title}</summary><ul>${links}</ul></details>`;
  }).join("");
  const headings = [...html.matchAll(/<h([23]) id="([^"]+)">([^<]+)<\/h\1>/g)];
  const toc = headings.map(([, level, id, title]) =>
    `<li${level === "3" ? ' class="docs-toc-subsection"' : ""}><a href="#${id}">${title}</a></li>`).join("");
  const index = docsRoutes.indexOf(route);
  const pageLink = (route: string | undefined, direction: string) => {
    if (!route) return "<span></span>";
    const title = docsGroups.flatMap((group) => group.items).find(([, href]) => href === route)![0];
    return `<a href="${route}"><span>${direction}</span>${escape(title)}</a>`;
  };
  return html.replace("<!--docs-sidebar-->", sidebar)
    .replace("<!--docs-toc-->", toc)
    .replace("<!--docs-group-->", group.title)
    .replace("<!--docs-pagination-->", pageLink(docsRoutes[index - 1], "Previous") + pageLink(docsRoutes[index + 1], "Next"));
}

export const docsLayoutPlugin: Plugin = {
  name: "docs-layout",
  transformIndexHtml: { order: "pre", handler: (html, context) => docsLayout(html, context.filename) },
};
