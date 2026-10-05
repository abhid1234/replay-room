import { describe, expect, it } from "vitest";
import {
  OPERATOR_TOKEN_KEY,
  clearOperatorCredential,
  loadOperatorCredential,
  saveOperatorCredential,
  type TokenStorage,
} from "../web/src/token-storage.js";

class MemoryStorage implements TokenStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("operator token storage", () => {
  it("prefers the session credential", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(OPERATOR_TOKEN_KEY, "persistent");
    session.setItem(OPERATOR_TOKEN_KEY, "session");

    expect(loadOperatorCredential(local, session)).toEqual({ token: "session", remember: false });
    expect(local.getItem(OPERATOR_TOKEN_KEY)).toBeNull();
  });

  it("migrates legacy always-persistent tokens into the session", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(OPERATOR_TOKEN_KEY, "legacy-token");

    expect(loadOperatorCredential(local, session)).toEqual({ token: "legacy-token", remember: false });
    expect(local.getItem(OPERATOR_TOKEN_KEY)).toBeNull();
    expect(session.getItem(OPERATOR_TOKEN_KEY)).toBe("legacy-token");
  });

  it("stores successful credentials in the session unless persistence is explicit", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();

    saveOperatorCredential("session-token", false, local, session);
    expect(session.getItem(OPERATOR_TOKEN_KEY)).toBe("session-token");
    expect(local.getItem(OPERATOR_TOKEN_KEY)).toBeNull();

    saveOperatorCredential("remembered-token", true, local, session);
    expect(local.getItem(OPERATOR_TOKEN_KEY)).toBe("remembered-token");
    expect(session.getItem(OPERATOR_TOKEN_KEY)).toBeNull();
  });

  it("clears both storage scopes on disconnect", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    local.setItem(OPERATOR_TOKEN_KEY, "persistent");
    session.setItem(OPERATOR_TOKEN_KEY, "session");

    clearOperatorCredential(local, session);
    expect(local.getItem(OPERATOR_TOKEN_KEY)).toBeNull();
    expect(session.getItem(OPERATOR_TOKEN_KEY)).toBeNull();
  });
});
