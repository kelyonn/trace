import type { ReactNode } from "react";
import Icon from "../components/Icon";

export type ViewKey = "overview" | "cube" | "explore" | "activity" | "settings";

export const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "cube", label: "Cube" },
  { key: "explore", label: "Query" },
  { key: "activity", label: "Activity" },
  { key: "settings", label: "Sources" }
];

type Props = {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  theme: string;
  onToggleTheme: () => void;
  engineLabel?: string;
  engineOk: boolean | null;
  historyCount: number;
  topActions?: ReactNode;
  children: ReactNode;
};

/** The Trace mark: an isometric cube with an amber trace through its faces. Follows the theme. */
const Glyph = () => (
  <svg viewBox="4 6 56 52" aria-hidden>
    <polygon points="32,9 52,20.5 32,32 12,20.5" fill="currentColor" />
    <polygon points="12,20.5 32,32 32,55 12,43.5" fill="currentColor" opacity="0.62" />
    <polygon points="32,32 52,20.5 52,43.5 32,55" fill="currentColor" opacity="0.34" />
    <path
      d="M14.8 40.05 L21.2 37.29 L26.4 43.96 L32 41.66 L39.6 34.53 L44.4 34.07 L49.2 24.41"
      fill="none"
      stroke="var(--select)"
      strokeWidth="4.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="49.2" cy="24.41" r="4.4" fill="var(--select)" />
  </svg>
);

const AppShell = ({ view, onNavigate, theme, onToggleTheme, engineLabel, engineOk, historyCount, topActions, children }: Props) => (
  <div className="app">
    <header className="topbar">
      <button type="button" className="wordmark" onClick={() => onNavigate("overview")}>
        <Glyph />
        trace
      </button>
      <nav className="nav" aria-label="Primary">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? "nav-item active" : "nav-item"}
            aria-current={view === v.key ? "page" : undefined}
            onClick={() => onNavigate(v.key)}
          >
            {v.label}
            {v.key === "activity" && historyCount ? <span className="nav-count">{historyCount}</span> : null}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <span className="status-line" title="Query engine">
          <span className={engineOk === null ? "dot" : engineOk ? "dot ok" : "dot bad"} />
          {engineLabel ?? "connecting…"}
        </span>
        {topActions}
        <button
          type="button"
          className="btn icon"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title="Toggle theme"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </header>
    <main className="content">{children}</main>
  </div>
);

export default AppShell;
