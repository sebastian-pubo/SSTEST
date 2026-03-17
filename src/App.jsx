import { useEffect, useState } from "react";
import VentilationApp from "./VentilationApp.jsx";
import "./styles.css";

const THEME_KEY = "vd_theme_v1";

function ThemeToggle({ theme, setTheme }) {
  return (
    <button
      className="btn ghost"
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      title="Toggle theme"
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

export default function App() {
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  return (
    <>
      <div className="container" style={{ paddingBottom: 0 }}>
        <div className="card">
          <div className="topbar">
            <div>
              <div className="kicker">Survey tool</div>
              <div className="h1">Ventilation Assessment</div>
              <div className="small">
                Ventilation-only project base. HHSRS and suite selection removed.
              </div>
            </div>
            <div className="actions">
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </div>
          </div>
        </div>
      </div>

      <VentilationApp />

      <div className="container" style={{ paddingTop: 0 }}>
        <div style={{ height: 16 }} />
        <div className="small" style={{ textAlign: "center", opacity: 0.85 }}>
          Ventilation Assessment • Base project • Theme: {theme}
        </div>
      </div>
    </>
  );
}
