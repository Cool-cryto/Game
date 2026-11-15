import { useEffect, useRef, useState } from "react";
import { checkServer, connect, hasSession, online, signIn, signOut, useOnline } from "../net/online";

/** Sign in, then pick the Global World, create a private server, or join one with a code. */
export function OnlineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  // Close once you're in a room.
  const room = useOnline((s) => s.room);
  useEffect(() => {
    if (room && open) onClose();
  }, [room, open, onClose]);

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-label="Play online">
      {open && <Body onClose={onClose} />}
    </dialog>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const available = useOnline((s) => s.available);
  const user = useOnline((s) => s.user);
  const status = useOnline((s) => s.status);
  useEffect(() => {
    void checkServer().then((ok) => ok && hasSession() && connect());
  }, []);

  return (
    <div className="dialog__body">
      <div className="dialog__head">
        <h2>Play online</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {available === null && <p className="dialog__sub">Looking for the game server…</p>}
      {available === false && (
        <div className="panel__note">
          <p>
            <strong>No game server here.</strong> Online play needs the game server running alongside the game. On your computer, run{" "}
            <code>npm start</code> in the project folder and open the address it prints. A copy of the game opened as a plain web page (like the
            shared preview link) can only be played single-player.
          </p>
        </div>
      )}
      {available && !user && (status === "connecting" || (hasSession() && status !== "offline") ? <p className="dialog__sub">Signing in…</p> : <SignIn />)}
      {available && user && <Lobby />}
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(useOnline.getState().error);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="signin"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(await signIn(mode, username.trim(), password));
        setBusy(false);
      }}
    >
      <div className="segmented signin__tabs" role="tablist">
        {(["login", "register"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "is-on" : undefined} onClick={() => setMode(m)}>
            {m === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={20} />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={8}
        />
      </label>
      {mode === "register" && <p className="dialog__hint">3–20 letters, numbers, - or _. Passwords need at least 8 characters.</p>}
      {error && <p className="dialog__msg dialog__msg--error">{error}</p>}
      <button className="btn btn--primary" type="submit" disabled={busy}>
        {mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

function Lobby() {
  const user = useOnline((s) => s.user)!;
  const rooms = useOnline((s) => s.rooms);
  const error = useOnline((s) => s.error);
  const [name, setName] = useState(`${user.username}'s world`);
  const [code, setCode] = useState("");
  useEffect(() => {
    online.list();
  }, []);
  const world = rooms.filter((r) => r.isPublic);
  const mine = rooms.filter((r) => !r.isPublic);

  return (
    <div className="lobby">
      <p className="dialog__sub">
        Signed in as <strong>{user.username}</strong> ·{" "}
        <button className="link" onClick={signOut}>
          Sign out
        </button>
      </p>

      <h3>Global world</h3>
      {world.map((r) => (
        <RoomRow key={r.id} room={r} />
      ))}

      <h3>Your private servers</h3>
      {mine.length === 0 && <p className="dialog__hint">None yet. Create one and send the invite code to friends.</p>}
      {mine.map((r) => (
        <RoomRow key={r.id} room={r} />
      ))}

      <h3>New private server</h3>
      <form
        className="dialog__row"
        onSubmit={(e) => {
          e.preventDefault();
          online.create(name);
        }}
      >
        <input className="input" aria-label="Server name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button className="btn btn--primary" type="submit">
          Create
        </button>
      </form>
      <p className="dialog__hint">Up to 50 players. You're the host: you control the game speed.</p>

      <h3>Join with an invite code</h3>
      <form
        className="dialog__row"
        onSubmit={(e) => {
          e.preventDefault();
          online.join(code.trim());
        }}
      >
        <input className="input input--code" aria-label="Invite code" placeholder="ABC234" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} />
        <button className="btn btn--ghost" type="submit" disabled={code.trim().length < 6}>
          Join
        </button>
      </form>
      {error && (
        <p className="dialog__msg dialog__msg--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function RoomRow({ room }: { room: import("@gs/sim").RoomSummary }) {
  return (
    <div className="slot" data-testid={`room-${room.isPublic ? "world" : room.code}`}>
      <div className="slot__info">
        <strong>{room.name}</strong>
        <span>
          {room.online} online · {room.players}/{room.maxPlayers} players{room.code ? ` · code ${room.code}` : ""}
        </span>
      </div>
      <button className="btn btn--primary btn--small" onClick={() => online.join(room.id)}>
        Join
      </button>
    </div>
  );
}
