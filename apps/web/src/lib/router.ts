import { useSyncExternalStore } from "react";

export type Route =
  | { name: "landing" }
  | { name: "login" }
  | { name: "signup" }
  | { name: "new" }
  | { name: "conversation"; id: string }
  | { name: "mobile"; id: string };

function parse(pathname: string): Route {
  if (pathname === "/login") return { name: "login" };
  if (pathname === "/signup") return { name: "signup" };
  if (pathname === "/new") return { name: "new" };
  const conversation = pathname.match(/^\/c\/([\w-]+)/);
  if (conversation) return { name: "conversation", id: conversation[1] };
  const mobile = pathname.match(/^\/mobile\/([\w-]+)/);
  if (mobile) return { name: "mobile", id: mobile[1] };
  return { name: "landing" };
}

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (location.pathname + location.search === path) return;
  history[options.replace ? "replaceState" : "pushState"](null, "", path);
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
