import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import FaqMiddleSimple from "../components/ui/faq-middle-simple";
import UnmetLanding from "../UnmetLanding";

describe("landing FAQ", () => {
  test("renders five collapsed, labelled accordion buttons under a section heading", () => {
    const markup = renderToStaticMarkup(<FaqMiddleSimple />);
    const titleId = markup.match(/<h2 id="([^"]+)"/)?.[1];
    expect(titleId).toBeDefined();
    expect(markup).toContain(`<section aria-labelledby="${titleId}"`);
    expect(markup).toContain("Frequently asked questions</h2>");
    const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
    expect(buttons).toHaveLength(5);
    const questions = [
      "What is UNMET?",
      "How does funding a demand work?",
      "How does a builder get paid?",
      "What happens if I do not approve a proposal?",
      "Does funding a demand include future API usage?",
    ];
    for (const [index, button] of buttons.entries()) {
      expect(button[1]).toContain('type="button"');
      expect(button[1]).toContain('aria-expanded="false"');
      expect(button[1]).toContain("aria-controls=");
      expect(button[2]).toContain(questions[index]);
    }
    expect(markup).not.toContain('role="region"');
  });

  test("places one FAQ after the ecosystem marquee and before the footer", () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
    try {
      const markup = renderToStaticMarkup(<MemoryRouter><UnmetLanding /></MemoryRouter>);
      const how = markup.indexOf('id="how-it-works"');
      const marquee = markup.indexOf('aria-label="UNMET ecosystem"');
      const faq = markup.indexOf("Frequently asked questions</h2>");
      const footer = markup.indexOf('<footer class="unmet-footer"');
      expect(markup.match(/<main\b/g)).toHaveLength(1);
      expect(markup.indexOf('<main>')).toBeLessThan(markup.indexOf('id="unmet-landing"'));
      expect(markup.indexOf('class="unmet-nav"')).toBeLessThan(markup.indexOf('class="unmet-hero"'));
      expect(markup.indexOf('</main>')).toBeGreaterThan(faq);
      expect(markup.indexOf('</main>')).toBeLessThan(footer);
      expect(how).toBeGreaterThan(-1);
      expect(marquee).toBeGreaterThan(how);
      expect(faq).toBeGreaterThan(marquee);
      expect(footer).toBeGreaterThan(faq);
      expect(markup.match(/Frequently asked questions<\/h2>/g)).toHaveLength(1);
      expect(markup).toContain('type="image/webp"');
      expect(markup).toContain('/assets/infrastructure-480-cef2886f24c7.webp 480w');
      expect(markup).toContain('/assets/infrastructure-2172-a007b14e973a.webp 2172w');
      const fallback = markup.match(/<img\b[^>]*src="\/images\/unmet-market-infrastructure\.png"[^>]*>/)?.[0] ?? "";
      expect(fallback).toContain('width="2172"');
      expect(fallback).toContain('height="724"');
      expect(fallback).toContain('loading="lazy"');
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    }
  });
});
