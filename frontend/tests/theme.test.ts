import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { THEME_BOOTSTRAP, THEME_STORAGE_KEY } from "../theme-bootstrap.ts";
import { getThemeSnapshot, setTheme, syncThemeFromStorage } from "../theme.ts";
import { unmetLogoSource } from "../UnmetLogo.tsx";

function runBootstrap(value: string | Error | undefined) {
  const styles: { textContent: string }[] = [];
  const themeColor = { content: "#070b12" };
  const document = {
    documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> },
    createElement: () => ({ textContent: "" }),
    querySelector: () => themeColor,
    head: { append: (style: { textContent: string }) => styles.push(style) },
  };
  const context: { document: typeof document; localStorage?: { getItem: () => string | null } } = { document };
  if (value !== undefined) {
    context.localStorage = { getItem: () => { if (value instanceof Error) throw value; return value; } };
  }
  runInNewContext(THEME_BOOTSTRAP, context);
  return { theme: document.documentElement.dataset.theme, rootStyle: document.documentElement.style, styles, themeColor: themeColor.content };
}

describe("theme preference", () => {
  it("selects the light and dark UNMET logo assets", () => {
    expect(unmetLogoSource("light")).toBe("/logos/unmet.png");
    expect(unmetLogoSource("dark")).toBe("/logos/unmet-dark.png");
  });
  it("runs the pre-CSS bootstrap for saved, invalid, missing, and blocked storage", () => {
    expect(runBootstrap("dark").theme).toBe("dark");
    const dark = runBootstrap("dark");
    expect(dark.themeColor).toBe("#101010");
    expect(runBootstrap("light").themeColor).toBe("#070b12");
    expect(dark.rootStyle).toMatchObject({ colorScheme: "dark", backgroundColor: "#101010" });
    expect(dark.styles[0]?.textContent).toContain("html[data-theme=dark] body{background:#101010;color:#ededed}");
    expect(runBootstrap("light").theme).toBe("light");
    expect(runBootstrap("invalid").theme).toBe("light");
    expect(runBootstrap(undefined).theme).toBe("light");
    expect(runBootstrap(new Error("blocked")).theme).toBe("light");
  });

  it("defaults to light, follows stored changes, and ignores unrelated storage keys", () => {
    setTheme("light");
    syncThemeFromStorage("unrelated", "dark");
    expect(getThemeSnapshot()).toBe("light");
    syncThemeFromStorage(THEME_STORAGE_KEY, "dark");
    expect(getThemeSnapshot()).toBe("dark");
    syncThemeFromStorage(THEME_STORAGE_KEY, "invalid");
    expect(getThemeSnapshot()).toBe("light");
    syncThemeFromStorage(null, null);
    expect(getThemeSnapshot()).toBe("light");
  });

  it("uses shared canvas tokens in dark mode and clears inline colors in light mode", () => {
    const originalDocument = globalThis.document;
    const themeColor = { content: "" };
    const appRoot = { style: {} as Record<string, string> };
    const documentState = {
      documentElement: { dataset: {} as Record<string, string>, style: {} as Record<string, string> },
      body: { style: {} as Record<string, string> },
      getElementById: () => appRoot,
      querySelector: () => themeColor,
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: documentState });
    try {
      setTheme("dark");
      expect(themeColor.content).toBe("#101010");
      expect(documentState.documentElement.style.backgroundColor).toBe("var(--unmet-theme-page, #101010)");
      expect(documentState.body.style.backgroundColor).toBe("var(--unmet-theme-page, #101010)");
      expect(documentState.body.style.color).toBe("var(--unmet-theme-text, #ededed)");
      expect(appRoot.style.backgroundColor).toBe("var(--unmet-theme-page, #101010)");
      setTheme("light");
      expect(themeColor.content).toBe("#070b12");
      syncThemeFromStorage(THEME_STORAGE_KEY, "dark");
      expect(themeColor.content).toBe("#101010");
      syncThemeFromStorage(null, null);
      expect(themeColor.content).toBe("#070b12");
      expect(documentState.documentElement.style.backgroundColor).toBe("");
      expect(documentState.body.style.color).toBe("");
      expect(appRoot.style.backgroundColor).toBe("");
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      setTheme("light");
    }
  });

  it("keeps the in-memory selection when storage writes fail", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { setItem: () => { throw new Error("blocked"); } } },
    });
    try {
      setTheme("dark");
      expect(getThemeSnapshot()).toBe("dark");
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
      setTheme("light");
    }
  });
});
