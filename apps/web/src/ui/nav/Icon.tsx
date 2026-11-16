/** Small line icons (16px, stroke = currentColor) used by the navigation and screens. */
const PATHS: Record<string, string> = {
  world: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18",
  country: "M5 21V4M5 4h11l-2 4l2 4H5",
  economy: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  military: "M12 3l7 3v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6z",
  diplomacy: "M7 12l3 3l7-7M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0",
  government: "M3 10l9-6l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18",
  research: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3",
  construction: "M3 21h18M5 21V10l7-5l7 5v11M9 21v-6h6v6",
  statistics: "M4 4v16h16M8 16l4-5l3 3l5-7",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  settings: "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1",
  online: "M9 11a3 3 0 1 0 0-6a3 3 0 1 0 0 6M3 20c.6-3.3 3-5 6-5s5.4 1.7 6 5M16 11a2.5 2.5 0 1 0 0-5M17.5 15c2 .4 3.2 2 3.5 5",
  back: "M15 6l-6 6l6 6",
  close: "M6 6l12 12M18 6L6 18",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name] ?? PATHS.more} />
    </svg>
  );
}
