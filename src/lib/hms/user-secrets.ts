/**
 * Password material for staff accounts (phase 4b, item 4).
 *
 * The room keeps `passwordHash` and `salt` and checks every sign-in. Devices,
 * the local database, .keg backups and Drive files never keep them: they are
 * stripped before anything is saved or sent out. A device signs staff in with a
 * per-device PIN instead (offline-signin.ts).
 */

export const SECRET_USER_FIELDS = ["passwordHash", "salt"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A copy of a user record with its password material removed. */
export function stripUserSecrets<T>(value: T): T {
  if (!isPlainObject(value)) return value;
  const copy: Record<string, unknown> = { ...value };
  for (const field of SECRET_USER_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * The record an edit should be stored as. An edit that does not carry the
 * password material (a role change, a rename) keeps the stored material, so the
 * account can still sign in with its password.
 */
export function keepStoredUserSecrets(incoming: unknown, stored: unknown): unknown {
  if (!isPlainObject(incoming) || !isPlainObject(stored)) return incoming;
  const out: Record<string, unknown> = { ...incoming };
  for (const field of SECRET_USER_FIELDS) {
    if (out[field] === undefined && stored[field] !== undefined) out[field] = stored[field];
  }
  return out;
}

/** A state with the password material removed from every user. */
export function stripStateUserSecrets<S extends { users: Record<string, unknown> }>(state: S): S {
  const users: Record<string, unknown> = {};
  for (const [id, user] of Object.entries(state.users)) users[id] = stripUserSecrets(user);
  return { ...state, users: users as S["users"] };
}
