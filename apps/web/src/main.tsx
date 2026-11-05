import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Theme: saved choice, else follow the OS. Set before first paint to avoid a flash.
(() => {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("trace_theme");
  } catch {
    /* storage unavailable */
  }
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : prefersLight ? "light" : "dark";
})();

const root = document.getElementById("root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
