import { useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

const KEY = "synod.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

export function getTheme(): ThemePreference {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function apply() {
  const pref = getTheme();
  const dark = pref === "dark" || (pref === "system" && media.matches);
  const root = document.documentElement;
  // Swap without transitions so every surface changes in the same frame.
  root.classList.add("no-transitions");
  root.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#fcfcfc");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transitions")));
}

export function initTheme() {
  apply();
  media.addEventListener("change", () => {
    apply();
    listeners.forEach((l) => l());
  });
}

export function setTheme(pref: ThemePreference) {
  if (pref === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, pref);
  apply();
  listeners.forEach((l) => l());
}

export function useTheme(): ThemePreference {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme
  );
}
