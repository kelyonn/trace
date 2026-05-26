import type { ReactNode } from "react";

type Props = {
  hero: ReactNode;
  left: ReactNode;
  right: ReactNode;
  governance: ReactNode;
  access: ReactNode;
};

const AppShell = ({ hero, left, right, governance, access }: Props) => (
  <main className="page">
    <section className="hero">{hero}</section>
    <div className="workspace">
      <div className="workspace-left">{left}</div>
      <div className="workspace-right">{right}</div>
    </div>
    <div className="workspace-governance">{governance}</div>
    {access}
  </main>
);

export default AppShell;
