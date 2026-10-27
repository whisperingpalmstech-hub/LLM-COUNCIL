import { useSyncExternalStore } from "react";

export type Route = { name: "home" } | { name: "conversation"; id: string } | { name: "mobile"; id: string };

function parse(pathname: string): Route {
  const conversation = pathname.match(/^\/c\/([\w-]+)/);
  if (conversation) return { name: "conversation", id: conversation[1] };
  const mobile = pathname.match(/^\/mobile\/([\w-]+)/);
  if (mobile) return { name: "mobile", id: mobile[1] };
  return { name: "home" };
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function navigate(path: string) {
  if (location.pathname === path) return;
  history.pushState(null, "", path);
  listeners.forEach((l) => l());
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => location.pathname
  );
  return parse(pathname);
}
