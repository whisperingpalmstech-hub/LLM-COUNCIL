import { useSyncExternalStore } from "react";
import type { AuthUser } from "@synod/contracts";
import { api } from "./api";
import { store } from "./store";

type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: AuthUser };

let state: AuthState = { status: "loading" };
const listeners = new Set<() => void>();

function set(next: AuthState) {
  state = next;
  if (next.status === "signed-in") store.connect();
  else if (next.status === "signed-out") store.reset();
  listeners.forEach((l) => l());
}

export function initAuth() {
  api.me().then(
    ({ user }) => set({ status: "signed-in", user }),
    () => set({ status: "signed-out" })
  );
  window.addEventListener("synod:signed-out", () => state.status === "signed-in" && set({ status: "signed-out" }));
}

export function signedIn(user: AuthUser) {
  set({ status: "signed-in", user });
}

export async function signOut() {
  await api.logout().catch(() => undefined);
  set({ status: "signed-out" });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}
