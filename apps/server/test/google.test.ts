import assert from "node:assert/strict";
import { test } from "node:test";
import { googleAuthUrl, readState } from "../src/auth/google.ts";

test("Google state is signed, expires, and is bound to the browser's nonce cookie", () => {
  const { url, nonce } = googleAuthUrl({ clientId: "cid", clientSecret: "s" }, "https://x.test/api/auth/google/callback", "secret", { invite: "code", next: "/c/1" });
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "accounts.google.com");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://x.test/api/auth/google/callback");
  const state = parsed.searchParams.get("state")!;
  const payload = readState("secret", state, nonce);
  assert.equal(payload.invite, "code");
  assert.equal(payload.next, "/c/1");
  assert.throws(() => readState("secret", state, "other-browser"), /couldn't be verified/);
  assert.throws(() => readState("wrong-secret", state, nonce), /took too long/);
  assert.throws(() => readState("secret", state.slice(0, -2) + "xx", nonce));
});
