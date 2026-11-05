import { useState, type ReactNode } from "react";
import Icon, { BrandMark } from "../components/Icon";

export type ViewKey = "overview" | "explore" | "cube" | "activity" | "settings";

export const VIEWS: { key: ViewKey; label: string; icon: string; title: string; sub: string }[] = [
  { key: "overview", label: "Overview", icon: "overview", title: "Overview", sub: "Live KPIs and trends from the active source" },
  { key: "explore", label: "Explore", icon: "explore", title: "Explore", sub: "Schema, semantic builder, SQL and results" },
  { key: "cube", label: "Cube Studio", icon: "cube", title: "Cube Studio", sub: "Slice, dice and drill the revenue cube in 3-D" },
  { key: "activity", label: "Activity", icon: "activity", title: "Activity & governance", sub: "History, audit, insights, snapshots, alerts" },
  { key: "settings", label: "Sources & access", icon: "settings", title: "Sources & access", sub: "Engine status, data sources and identity" }
];

type Props = {
  view: ViewKey;
  onNavigate: (v: ViewKey) => void;
  theme: string;
  onToggleTheme: () => void;
  engineLabel?: string;
  engineOk: boolean | null;
  role: string;
  activeSourceName?: string;
  historyCount: number;
  topActions?: ReactNode;
  children: ReactNode;
};

const AppShell = ({
  view,
  onNavigate,
  theme,
  onToggleTheme,
  engineLabel,
  engineOk,
  role,
  activeSourceName,
  historyCount,
  topActions,
  children
}: Props) => {
  const [navOpen, setNavOpen] = useState(false);
  const meta = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  return (
    <div className="app">
      <aside className={navOpen ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <BrandMark className="brand-mark" />
          <div>
            <div className="brand-name">Trace</div>
            <div className="brand-tag">Virtual OLAP · 3-D</div>
          </div>
        </div>
        <div className="nav-section">Workspace</div>
        {VIEWS.slice(0, 3).map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? "nav-item active" : "nav-item"}
            onClick={() => {
              onNavigate(v.key);
              setNavOpen(false);
            }}
            aria-current={view === v.key ? "page" : undefined}
          >
            <Icon name={v.icon} />
            {v.label}
          </button>
        ))}
        <div className="nav-section">Govern</div>
        {VIEWS.slice(3).map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? "nav-item active" : "nav-item"}
            onClick={() => {
              onNavigate(v.key);
              setNavOpen(false);
            }}
            aria-current={view === v.key ? "page" : undefined}
          >
            <Icon name={v.icon} />
            {v.label}
            {v.key === "activity" && historyCount ? <span className="nav-badge">{historyCount}</span> : null}
          </button>
        ))}
        <div className="sidebar-footer">
          <div className="engine-chip">
            <span className={engineOk === null ? "dot" : engineOk ? "dot ok" : "dot bad"} />
            <span>{engineLabel ?? "Connecting…"}</span>
          </div>
          <div className="engine-chip">
            <Icon name="database" size={14} />
            <span>{activeSourceName ?? "No source"}</span>
          </div>
          <div className="engine-chip">
            <Icon name="shield" size={14} />
            <span>
              Role: <b>{role}</b>
              {role !== "admin" ? " · PII masked" : ""}
            </span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="button ghost icon mobile-nav-toggle"
            aria-label="Open navigation"
            onClick={() => setNavOpen((v) => !v)}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <p>{meta.sub}</p>
          </div>
          <div className="topbar-actions">
            {topActions}
            <button
              type="button"
              className="button ghost icon"
              onClick={onToggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title="Toggle theme"
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
          </div>
        </header>
        <main className="content" key={view}>
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppShell;
