import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

/**
 * Accounts: a username and a password. Passwords are never stored, only a
 * salted scrypt hash. Logging in gives a random session token; the database
 * stores only a hash of it, so a leaked database can't be used to log in.
 */
export const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
export const MIN_PASSWORD = 8;

const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type AuthResult = { ok: true; token: string; user: { id: number; username: string } } | { ok: false; error: string };

export function register(db: Db, username: unknown, password: unknown): AuthResult {
  if (typeof username !== "string" || !USERNAME.test(username)) return { ok: false, error: "Usernames are 3–20 letters, numbers, - or _." };
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > 200)
    return { ok: false, error: `Passwords need at least ${MIN_PASSWORD} characters.` };
  if (db.userByName(username)) return { ok: false, error: "That username is taken." };
  const salt = randomBytes(16).toString("hex");
  const id = db.createUser(username, hashPassword(password, salt), salt);
  return startSession(db, { id, username });
}

export function login(db: Db, username: unknown, password: unknown): AuthResult {
  const fail = { ok: false as const, error: "Wrong username or password." };
  if (typeof username !== "string" || typeof password !== "string" || password.length > 200) return fail;
  const u = db.userByName(username);
  if (!u) {
    hashPassword(password, "timing-equaliser"); // same work either way, so timing doesn't reveal usernames
    return fail;
  }
  const given = Buffer.from(hashPassword(password, u.salt), "hex");
  if (!timingSafeEqual(given, Buffer.from(u.pass_hash, "hex"))) return fail;
  return startSession(db, { id: u.id, username: u.username });
}

function startSession(db: Db, user: { id: number; username: string }): AuthResult {
  const token = randomBytes(32).toString("base64url");
  db.addSession(hashToken(token), user.id);
  return { ok: true, token, user };
}

export const userForToken = (db: Db, token: unknown) => (typeof token === "string" && token.length < 200 ? db.sessionUser(hashToken(token)) : undefined);
export const logout = (db: Db, token: string) => db.deleteSession(hashToken(token));
