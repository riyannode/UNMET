import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import Services from "../Services.tsx";
import { CHAIN_ID, DEMAND_CONTRACT } from "../contract.ts";

type Pending = { resolve: (response: Response) => void; signal?: AbortSignal };
const pending: Pending[] = [];
window.fetch = (_input, init) => new Promise<Response>((resolve) => { pending.push({ resolve, signal: init?.signal ?? undefined }); });
const result = document.getElementById("result")!;
const root = document.getElementById("root")!;
const contract = DEMAND_CONTRACT;
const service = { demandId: "1", capability: "Verify", specification: '{"description":"Verify a business.","schemaVersion":"unmet-rfq-v1"}', builder: "0x1111111111111111111111111111111111111111", serviceUrl: "https://example.org/path", evidenceHash: `0x${"a".repeat(64)}` };
const envelope = { chainId: CHAIN_ID, contract, blockNumber: "42", blockHash: `0x${"b".repeat(64)}`, generatedAt: "2026-01-01T00:00:00.000Z" };
function Harness() {
  const navigate = useNavigate();
  return <><button id="list" onClick={() => navigate("/services")}>List</button><button id="detail" onClick={() => navigate(`/services/${CHAIN_ID}/${contract}/1`)}>Detail</button><button id="other" onClick={() => navigate(`/services/${CHAIN_ID}/${contract}/2`)}>Other</button><button id="invalid" onClick={() => navigate(`/services/${CHAIN_ID}/${contract}/0`)}>Invalid</button><button id="wrong-chain" onClick={() => navigate(`/services/1/${contract}/1`)}>Wrong chain</button><button id="wrong-contract" onClick={() => navigate(`/services/${CHAIN_ID}/0x2222222222222222222222222222222222222222/1`)}>Wrong contract</button><Routes><Route path="/services" element={<Services />} /><Route path="/services/:chainId/:contract/:demandId" element={<Services detail />} /></Routes></>;
}
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); }
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
async function navigate(id: string) { document.getElementById(id)?.click(); await tick(); }
async function reply(body: unknown, status = 200) { const request = pending.shift(); check(request, "missing request"); request!.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })); await tick(); }
function footer() {
  const element = root.querySelector(".services-page + .unmet-footer");
  check(element && root.querySelectorAll(".unmet-footer").length === 1, "one footer after services page");
  return element!.innerHTML;
}
void (async () => {
  try {
    check(contract, "Set VITE_DEMAND_CONTRACT and VITE_PAYMENT_TOKEN for fixture");
    createRoot(root).render(<MemoryRouter initialEntries={["/services"]}><Harness /></MemoryRouter>);
    await tick(); check(root.textContent?.includes("Loading services") && root.querySelector(".services-search") && root.querySelector(".services-rail") && root.querySelectorAll(".service-skeleton").length === 3, "loading shell");
    const listFooter = footer();
    await reply({ ...envelope, services: [] }); check(root.textContent?.includes("No fulfilled services"), "empty");
    await navigate("detail"); check(root.textContent?.includes("Loading services"), "detail loading");
    check(footer() === listFooter, "same footer on detail");
    await reply({}, 503); check(root.textContent?.includes("unavailable") && !root.textContent.includes("not found"), "503");
    await navigate("other"); await reply({}, 404); check(root.textContent?.includes("not found"), "404");
    await navigate("detail"); await reply({ ...envelope, service });
    check(root.textContent?.includes("Verify a business.") && root.textContent.includes(service.evidenceHash) && root.textContent.includes(service.builder) && root.textContent.includes(service.serviceUrl) && root.textContent.includes(String(CHAIN_ID)) && root.textContent.toLowerCase().includes(contract!.toLowerCase()) && root.textContent.includes("Demand ID"), "detail fields");
    check(root.querySelector('a[href="https://example.org/path"]'), "https link");
    await navigate("other"); check(!root.textContent?.includes("Verify a business."), "stale route data");
    await reply({ ...envelope, service }, 200); check(root.textContent?.includes("unavailable"), "identity mismatch");
    await navigate("invalid"); check(root.textContent?.includes("Invalid service route"), "invalid route");
    for (const route of ["wrong-chain", "wrong-contract"]) {
      const count = pending.length;
      await navigate(route);
      check(root.textContent?.includes("Invalid service route") && pending.length === count, "wrong deployment route");
    }
    await navigate("list"); await reply({ ...envelope, chainId: CHAIN_ID + 1, services: [service] });
    check(root.textContent?.includes("unavailable") && !root.textContent.includes("Verify a business."), "wrong response chain");
    await navigate("detail"); await reply({ ...envelope, contract: "0x2222222222222222222222222222222222222222", service });
    check(root.textContent?.includes("unavailable") && !root.textContent.includes("Verify a business."), "wrong response contract");
    await navigate("list"); await reply({ ...envelope, services: [{ ...service, demandId: "bad" }] }); check(root.textContent?.includes("unavailable"), "malformed row");
    await navigate("detail"); await reply({ ...envelope, service: { ...service, serviceUrl: "https://user:pass@example.org" } });
    check(!root.querySelector('a[href="https://user:pass@example.org"]'), "credential URL");
    for (const [specification, url] of [["  historical prose  ", "http://example.org"], ["{broken", "javascript:alert(1)"], ['{"schemaVersion":"unmet-rfq-v2","description":"future"}', "https://user:pass@example.org"]]) {
      await navigate("list"); await reply({ ...envelope, services: [] });
      await navigate("detail"); await reply({ ...envelope, service: { ...service, specification, serviceUrl: url } });
      check(root.textContent?.includes(specification.trim()), "raw specification fallback");
      check(root.textContent?.includes(url) && !root.querySelector(`a[href="${url}"]`), "unsafe URL is text");
    }
    await navigate("list"); await reply({ ...envelope, services: [service, { ...service, demandId: "27", capability: "Translate", specification: "Translate a document." }] });
    check(root.querySelector('ul li article') && root.textContent?.includes("Verify a business."), "list semantics");
    const card = root.querySelector<HTMLAnchorElement>(`a[href="/services/${CHAIN_ID}/${contract?.toLowerCase()}/1"]`);
    check(card?.querySelector("article") && card.tabIndex === 0 && !card.querySelector("a, button"), "canonical full card link and keyboard focus");
    const cards = [...root.querySelectorAll<HTMLAnchorElement>(".service-card-link")];
    const labels = cards.map((link) => link.getAttribute("aria-labelledby"));
    check(labels.every((id, index) => id && cards[index].querySelector("h2")?.id === id && document.getElementById(id)?.textContent?.trim()), "card links labelled by their headings");
    check(new Set(labels).size === cards.length, "card heading IDs are unique");
    const input = root.querySelector<HTMLInputElement>("#services-search")!;
    async function search(value: string) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await tick();
    }
    for (const query of ["verify", "business", "1"]) {
      await search(query);
      check(root.querySelectorAll(".services-grid li").length === 1 && root.textContent?.includes("Verify a business."), `search ${query}`);
    }
    await search("27"); check(root.querySelectorAll(".services-grid li").length === 1 && root.textContent?.includes("Translate a document."), "search demand ID");
    await search("missing"); check(root.textContent?.includes("No matching services") && !root.textContent.includes("No fulfilled services"), "search empty");
    root.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')?.click(); await tick();
    check(root.querySelectorAll(".services-grid li").length === 2 && input.value === "" && document.activeElement === input, "clear search and restore focus");
    await search("   "); check(root.querySelectorAll(".services-grid li").length === 2, "whitespace search");
    const menu = root.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]'); menu?.click(); await tick();
    check(root.querySelector('.unmet-mobile-menu a[href="/services"]'), "mobile Services navigation");
    result.textContent = "PASS";
  } catch (error) { result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`; }
})();
