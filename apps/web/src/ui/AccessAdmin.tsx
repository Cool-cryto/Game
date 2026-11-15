import { useEffect, useState } from "react";
import { adminSearch, adminSetAccess, useAccess, type AdminUser } from "../net/access";

const LABEL: Record<NonNullable<AdminUser["access"]> | "none", string> = { paid: "Bought", granted: "Free pass", admin: "Admin", none: "No access" };

/** For admins (paywall on): give a username a free pass, or take it away. */
export function AccessAdmin() {
  const isAdmin = useAccess((s) => !!s.me?.admin && !!s.config?.paywall);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const load = (q: string) => adminSearch(q).then(setUsers, (e: Error) => setMessage(e.message));
  useEffect(() => {
    if (isAdmin) void load("");
  }, [isAdmin]);
  if (!isAdmin) return null;

  const set = async (username: string, access: "granted" | null) => {
    const err = await adminSetAccess(username, access);
    setMessage(err ?? (access ? `${username} can now play for free.` : `${username}'s free pass was removed.`));
    await load(query);
  };

  return (
    <>
      <h3>Free passes</h3>
      <p className="dialog__hint">Players create an account, then tell you their username. Give them a pass here and they can play without paying.</p>
      <form
        className="dialog__row"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) void set(query.trim(), "granted");
        }}
      >
        <input
          className="input"
          aria-label="Username"
          placeholder="Username"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            void load(e.target.value);
          }}
          maxLength={20}
        />
        <button className="btn btn--primary btn--small" disabled={!query.trim()}>
          Give free pass
        </button>
      </form>
      {message && (
        <p className="dialog__hint" role="status">
          {message}
        </p>
      )}
      <div className="access-admin__list" aria-label="Players">
        {users.map((u) => (
          <div key={u.username} className="access-admin__row">
            <span>
              <strong>{u.username}</strong> <span className="tag">{LABEL[u.access ?? "none"]}</span>
            </span>
            {u.access === null && (
              <button className="btn btn--ghost btn--small" onClick={() => void set(u.username, "granted")}>
                Give free pass
              </button>
            )}
            {u.access === "granted" && (
              <button className="btn btn--danger btn--small" onClick={() => void set(u.username, null)}>
                Remove pass
              </button>
            )}
          </div>
        ))}
        {!users.length && <p className="dialog__hint">No players found.</p>}
      </div>
    </>
  );
}
