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

/** A plain glyph: three stacked planes of a cube, drawn with hairlines. */
const Glyph = () => (
  <svg viewBox="0 0 16 16" aria-hidden>
    <path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M2 4.8 8 8.1l6-3.3M8 8.1v6.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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
