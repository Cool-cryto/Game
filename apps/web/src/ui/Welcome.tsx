import { useState } from "react";
import { refreshAccess, startCheckout, formatPrice, useAccess } from "../net/access";
import { signIn, signOut } from "../net/online";

const FEATURES: { title: string; text: string; icon: string }[] = [
  { icon: "🌍", title: "The whole Earth", text: "248 countries and territories, 4,596 provinces and 7,000+ cities on a flat map or a 3D globe." },
  { icon: "📈", title: "Real economies", text: "GDP, taxes, budgets, debt, research and infrastructure, starting from real-world data." },
  { icon: "⚔️", title: "Armies, fleets, air power", text: "Recruit, march, besiege and invade by sea. Battles weigh technology, home ground and air support." },
  { icon: "🤝", title: "Diplomacy", text: "Relations, alliances, wars that pull in allies, and peace deals that redraw the map." },
  { icon: "🌫️", title: "Fog of war", text: "You only see foreign armies near your land, your units and your allies." },
  { icon: "👥", title: "Play together", text: "A shared Global World, or private servers for up to 50 friends with an invite code." },
  { icon: "🕰️", title: "History and custom worlds", text: "Start in today's world or 1991 as the Cold War ends, or paint your own world in the editor." },
  { icon: "🤖", title: "Living AI", text: "Every country you don't play runs itself: budgets, armies, alliances and wars." },
];

/** The menu shown before the game is unlocked: what the game is, how to get it, and signing in. */
export function Welcome() {
  const config = useAccess((s) => s.config)!;
  const me = useAccess((s) => s.me);
  const notice = useAccess((s) => s.notice);
  const price = formatPrice(config);
  const toAccount = () => document.getElementById("account")?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="welcome" data-testid="welcome">
      <header className="welcome__bar">
        <span className="welcome__brand">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          World Ascendant
        </span>
        <nav className="welcome__nav" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#price">Price</a>
          <a href="#account">{me ? me.user.username : "Sign in"}</a>
        </nav>
      </header>

      <section className="welcome__hero">
        <p className="welcome__eyebrow">Grand strategy in your browser</p>
        <h1>Lead any nation on Earth.</h1>
        <p className="welcome__lead">
          Build its economy, command its armies, make allies and enemies, and shape the world, alone against living AI nations or online
          with friends.
        </p>
        <div className="welcome__cta">
          <button className="btn btn--primary" onClick={toAccount}>
            Get the full game · {price}
          </button>
          <a className="btn btn--ghost" href="#features">
            See what's inside
          </a>
        </div>
        {notice && (
          <p className="welcome__notice" role="status">
            {notice}
          </p>
        )}
      </section>

      <section id="features" className="welcome__section">
        <h2>What's inside</h2>
        <div className="welcome__grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="welcome__card">
              <span className="welcome__icon" aria-hidden>
                {f.icon}
              </span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="price" className="welcome__section welcome__split">
        <div className="welcome__price">
          <p className="welcome__eyebrow">One price, everything included</p>
          <p className="welcome__amount">
            {price} <span>once</span>
          </p>
          <ul>
            <li>Single player and online play</li>
            <li>All scenarios and the world editor</li>
            <li>Future updates included</li>
            <li>No subscription, no ads</li>
          </ul>
          <p className="welcome__small">
            Payments are handled securely by {config.provider === "stripe" ? "Stripe" : "Square"}. Your card details never reach this game's server.
          </p>
        </div>
        <div id="account" className="welcome__account">
          {me ? <Unlock /> : <SignInForm />}
        </div>
      </section>

      <section className="welcome__section welcome__faq">
        <h2>Questions</h2>
        <details>
          <summary>I was told I can play for free</summary>
          <p>Create an account and tell the person who invited you your username. Once they unlock it, press "Check again" or reload the page.</p>
        </details>
        <details>
          <summary>Does it work on my phone?</summary>
          <p>Yes, in any modern browser. A bigger screen is more comfortable for a whole world.</p>
        </details>
        <details>
          <summary>Do I buy it again on another device?</summary>
          <p>No. The game belongs to your account: sign in on any device.</p>
        </details>
      </section>

      <footer className="welcome__footer">
        Map data: Natural Earth (public domain) · 1991 figures: World Bank (CC BY 4.0) · Country facts: mledoze/countries (ODbL) · Governments: V-Dem Regimes of the World (CC BY-SA 4.0, via Our World in Data) and Wikidata (CC0) · Flags: flag-icons (MIT)
      </footer>
    </div>
  );
}

function SignInForm() {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="welcome__form"
      aria-label={mode === "register" ? "Create an account" : "Sign in"}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(await signIn(mode, username.trim(), password));
        setBusy(false);
        await refreshAccess();
      }}
    >
      <div className="welcome__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>
          Create account
        </button>
        <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>
          Sign in
        </button>
      </div>
      <label className="field">
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required maxLength={20} />
      </label>
      <label className="field">
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          minLength={mode === "register" ? 8 : 1}
        />
      </label>
      {mode === "register" && <p className="welcome__small">3–20 letters or numbers; a password of at least 8 characters.</p>}
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn--primary" disabled={busy}>
        {busy ? "One moment…" : mode === "register" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}

function Unlock() {
  const config = useAccess((s) => s.config)!;
  const me = useAccess((s) => s.me)!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="welcome__form">
      <p className="welcome__signed">
        Signed in as <strong>{me.user.username}</strong>
      </p>
      {config.canBuy ? (
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await startCheckout());
            setBusy(false);
          }}
        >
          {busy ? "Opening the payment page…" : `Unlock the full game · ${formatPrice(config)}`}
        </button>
      ) : (
        <p className="welcome__small">Purchases open soon. If you've been invited to play for free, see below.</p>
      )}
      {error && (
        <p className="welcome__error" role="alert">
          {error}
        </p>
      )}
      <div className="welcome__pass">
        <p>
          <strong>Got a free pass?</strong> Send your username <code>{me.user.username}</code> to the person who invited you, then:
        </p>
        <button className="btn btn--ghost" onClick={() => void refreshAccess()}>
          Check again
        </button>
      </div>
      <button
        className="link"
        onClick={async () => {
          signOut();
          await refreshAccess();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
