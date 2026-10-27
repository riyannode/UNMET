import { useSyncExternalStore } from "react";
import { THEME_BOOTSTRAP, THEME_STORAGE_KEY } from "./theme-bootstrap.ts";

export type Theme = "light" | "dark";
export { THEME_BOOTSTRAP, THEME_STORAGE_KEY };

let currentTheme: Theme = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const listeners = new Set<() => void>();

function applyTheme(theme: Theme): void {
  currentTheme = theme;
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme === "dark" ? "dark" : "";
    root.style.backgroundColor = theme === "dark" ? "var(--unmet-theme-page, #101010)" : "";
    if (document.body) {
      document.body.style.backgroundColor = theme === "dark" ? "var(--unmet-theme-page, #101010)" : "";
      document.body.style.color = theme === "dark" ? "var(--unmet-theme-text, #ededed)" : "";
    }
    const appRoot = document.getElementById("root");
    if (appRoot) appRoot.style.backgroundColor = theme === "dark" ? "var(--unmet-theme-page, #101010)" : "";
  }
  listeners.forEach((listener) => listener());
}

function readStoredTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function syncThemeFromStorage(key: string | null, value: string | null): void {
  if (key !== THEME_STORAGE_KEY && key !== null) return;
  applyTheme(readStoredTheme(value) ?? "light");
}

function onStorage(event: StorageEvent): void {
  syncThemeFromStorage(event.key, event.newValue);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function getThemeSnapshot(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The in-memory preference still applies when browser storage is unavailable.
  }
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getThemeSnapshot, () => "light");
}
