import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
// Node's built-in SQLite (no extra dependency). It prints an "experimental" warning once.
import { DatabaseSync } from "node:sqlite";

/** Who may play when the paywall is on. */
export type Access = "paid" | "granted" | null;

/**
 * Everything the server keeps between restarts: accounts, login sessions,
 * rooms (with their saved game) and who has joined which room.
 */
export class Db {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        is_public INTEGER NOT NULL,
        host_user_id INTEGER,
        state BLOB,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS members (
        room_id TEXT NOT NULL REFERENCES rooms(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        country TEXT,
        PRIMARY KEY (room_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS payments (
        checkout_id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        amount_cents INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    // Added with the paywall: who may play. NULL = not yet, 'paid' = bought the game, 'granted' = free pass from an admin.
    const columns = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "access")) this.db.exec("ALTER TABLE users ADD COLUMN access TEXT");
  }

  accessOf(userId: number): Access {
    const r = this.db.prepare("SELECT access FROM users WHERE id = ?").get(userId) as { access: string | null } | undefined;
    return (r?.access as Access) ?? null;
  }
  setAccess(userId: number, access: Access) {
    this.db.prepare("UPDATE users SET access = ? WHERE id = ?").run(access, userId);
  }
  /** Users matching a name search (for the admin screen), newest first. */
  findUsers(query: string, limit = 50) {
    const like = `%${query.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    return this.db
      .prepare("SELECT id, username, access, created_at FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?")
      .all(like, limit) as { id: number; username: string; access: Access; created_at: number }[];
  }
  /** Record a completed purchase. Returns false if it was already recorded (Stripe can send the same event twice). */
  addPayment(checkoutId: string, userId: number, amountCents: number): boolean {
    const r = this.db.prepare("INSERT OR IGNORE INTO payments (checkout_id, user_id, amount_cents, created_at) VALUES (?, ?, ?, ?)").run(checkoutId, userId, amountCents, Date.now());
    return Number(r.changes) > 0;
  }
  userById(id: number) {
    return this.db.prepare("SELECT id, username FROM users WHERE id = ?").get(id) as { id: number; username: string } | undefined;
  }

  createUser(username: string, passHash: string, salt: string): number {
    const r = this.db.prepare("INSERT INTO users (username, pass_hash, salt, created_at) VALUES (?, ?, ?, ?)").run(username, passHash, salt, Date.now());
    return Number(r.lastInsertRowid);
  }
  userByName(username: string) {
    return this.db.prepare("SELECT id, username, pass_hash, salt FROM users WHERE username = ?").get(username) as
      | { id: number; username: string; pass_hash: string; salt: string }
      | undefined;
  }
  addSession(tokenHash: string, userId: number) {
    this.db.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)").run(tokenHash, userId, Date.now());
  }
  sessionUser(tokenHash: string) {
    return this.db
      .prepare("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
      .get(tokenHash) as { id: number; username: string } | undefined;
  }
  deleteSession(tokenHash: string) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  saveRoom(r: { id: string; name: string; code: string | null; isPublic: boolean; hostUserId: number | null; state: Uint8Array }) {
    this.db
      .prepare(
        `INSERT INTO rooms (id, name, code, is_public, host_user_id, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, host_user_id = excluded.host_user_id, state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(r.id, r.name, r.code, r.isPublic ? 1 : 0, r.hostUserId, r.state, Date.now());
  }
  rooms() {
    return this.db.prepare("SELECT id, name, code, is_public, host_user_id, state FROM rooms").all() as {
      id: string;
      name: string;
      code: string | null;
      is_public: number;
      host_user_id: number | null;
      state: Uint8Array | null;
    }[];
  }
  setMember(roomId: string, userId: number, country: string | null) {
    this.db
      .prepare("INSERT INTO members (room_id, user_id, country) VALUES (?, ?, ?) ON CONFLICT(room_id, user_id) DO UPDATE SET country = excluded.country")
      .run(roomId, userId, country);
  }
  members(roomId: string) {
    return this.db.prepare("SELECT m.user_id, u.username, m.country FROM members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?").all(roomId) as {
      user_id: number;
      username: string;
      country: string | null;
    }[];
  }
  roomsOfUser(userId: number) {
    return this.db.prepare("SELECT room_id FROM members WHERE user_id = ?").all(userId).map((r) => (r as { room_id: string }).room_id);
  }
  close() {
    this.db.close();
  }
}
