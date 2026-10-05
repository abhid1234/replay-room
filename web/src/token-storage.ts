export const OPERATOR_TOKEN_KEY = "replay-room-token";

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OperatorCredential {
  token: string;
  remember: boolean;
}

function read(storage: TokenStorage): string {
  try {
    return storage.getItem(OPERATOR_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function remove(storage: TokenStorage): void {
  try {
    storage.removeItem(OPERATOR_TOKEN_KEY);
  } catch {
    // Storage can be unavailable in hardened or private browser contexts.
  }
}

function write(storage: TokenStorage, token: string): void {
  try {
    storage.setItem(OPERATOR_TOKEN_KEY, token);
  } catch {
    // The console remains usable even when browser storage is unavailable.
  }
}

export function loadOperatorCredential(local: TokenStorage, session: TokenStorage): OperatorCredential {
  const sessionToken = read(session);
  if (sessionToken) {
    remove(local);
    return { token: sessionToken, remember: false };
  }

  const legacyPersistentToken = read(local);
  if (!legacyPersistentToken) return { token: "", remember: false };

  // Older releases persisted every successful token indefinitely. Downgrade that
  // state to this tab's session; persistence now requires an explicit opt-in.
  remove(local);
  write(session, legacyPersistentToken);
  return { token: legacyPersistentToken, remember: false };
}

export function saveOperatorCredential(token: string, remember: boolean, local: TokenStorage, session: TokenStorage): void {
  remove(local);
  remove(session);
  if (!token) return;
  write(remember ? local : session, token);
}

export function clearOperatorCredential(local: TokenStorage, session: TokenStorage): void {
  remove(local);
  remove(session);
}
