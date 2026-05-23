import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
};

export function Button({ variant = "primary", className = "", children, ...props }: ButtonProps) {
  const base = variant === "ghost" ? "button ghost" : "button";
  return (
    <button type="button" className={`${base} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

type PanelProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  actions?: ReactNode;
};

export function Panel({ title, actions, children, className = "", ...props }: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()} {...props}>
      {title ? (
        <div className="panel-header">
          <h2>{title}</h2>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type PillProps = { tone?: "ok" | "warn"; children: ReactNode };

export function Pill({ tone = "ok", children }: PillProps) {
  return <span className={tone === "warn" ? "pill warn" : "pill ok"}>{children}</span>;
}
