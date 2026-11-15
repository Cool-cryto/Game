import { useEffect, useRef, useState } from "react";
import { flagUrl, getCountry } from "../data/countries";
import { online, useOnline } from "../net/online";
import { useGame } from "../state/gameStore";

/** While in an online room: a status pill that opens the players & chat drawer. */
export function OnlinePanel() {
  const room = useOnline((s) => s.room);
  const status = useOnline((s) => s.status);
  const players = useOnline((s) => s.players);
  const chat = useOnline((s) => s.chat);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  if (!room) return null;
  const unread = open ? 0 : Math.max(0, chat.length - seen);
  const onlineCount = players.filter((p) => p.online).length;

  return (
    <>
      <button
        className={`online-pill ${status !== "online" ? "online-pill--warn" : ""}`}
        onClick={() => {
          setOpen(!open);
          setSeen(chat.length);
        }}
        aria-expanded={open}
        data-testid="online-pill"
      >
        <span className={`dot ${status === "online" ? "dot--on" : "dot--warn"}`} aria-hidden />
        <span className="online-pill__name">{room.name}</span>
        <span className="online-pill__count">{status === "online" ? `${onlineCount} online` : "Reconnecting…"}</span>
        {unread > 0 && <span className="news__count">{unread}</span>}
      </button>
      {open && <Drawer onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const room = useOnline((s) => s.room)!;
  const players = useOnline((s) => s.players);
  const user = useOnline((s) => s.user);
  const states = useGame((s) => s.state.countries);
  const [copied, setCopied] = useState(false);

  return (
    <aside className="drawer" aria-label="Players and chat" data-testid="online-drawer">
      <div className="panel__head">
        <div className="panel__titles">
          <p className="panel__eyebrow">{room.isPublic ? "Public world" : "Private server"}</p>
          <h2>{room.name}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close players and chat">
          ×
        </button>
      </div>
      {room.code && (
        <div className="invite">
          <span>
            Invite code <strong data-testid="invite-code">{room.code}</strong>
          </span>
          <button
            className="btn btn--ghost btn--small"
            onClick={() => {
              void navigator.clipboard?.writeText(room.code!).then(() => setCopied(true), () => {});
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <h3>Players ({players.length}/{room.maxPlayers})</h3>
      <ul className="players" data-testid="players">
        {players.map((p) => {
          const c = p.country ? getCountry(p.country) : undefined;
          const flag = c ? flagUrl(c) : null;
          const aiNow = p.country && states[p.country]?.controller === "ai";
          return (
            <li key={p.userId} className="player-row">
              <span className={`dot ${p.online ? "dot--on" : ""}`} title={p.online ? "Online" : "Offline"} />
              <span className="player-row__name">
                {p.name}
                {p.userId === user?.id && " (you)"}
                {p.host && <span className="tag">host</span>}
              </span>
              <span className="player-row__country">
                {flag && <img src={flag} alt="" />}
                {c ? c.name : "No country yet"}
                {aiNow && <span className="tag">AI playing</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <Chat />
      <button className="btn btn--ghost" onClick={() => online.leave()}>
        Leave server
      </button>
      <p className="panel__small">Your country is saved on the server. If you disconnect, the AI runs it after 30 seconds until you come back.</p>
    </aside>
  );
}

function Chat() {
  const chat = useOnline((s) => s.chat);
  const [text, setText] = useState("");
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.scrollTo(0, list.current.scrollHeight);
  }, [chat]);
  return (
    <section className="chat" aria-label="Chat">
      <h3>Chat</h3>
      <ul ref={list} className="chat__list" data-testid="chat">
        {chat.length === 0 && <li className="news__empty">No messages yet.</li>}
        {chat.map((m, i) => (
          <li key={`${m.at}-${i}`}>
            <strong>{m.from}:</strong> {m.text}
          </li>
        ))}
      </ul>
      <form
        className="dialog__row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) online.chat(text);
          setText("");
        }}
      >
        <input className="input" aria-label="Chat message" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="Say something…" />
        <button className="btn btn--ghost btn--small" type="submit">
          Send
        </button>
      </form>
    </section>
  );
}
