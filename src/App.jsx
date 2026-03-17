import { useEffect, useState } from "react";
import VentilationApp from "./VentilationApp.jsx";
import HhsrsApp from "./HhsrsApp.jsx";
import "./styles.css";

const THEME_KEY = "vd_theme_v1";

const GLOBALS_KEY = "survey_suite_globals_v1";

function loadGlobals(){
  try { return JSON.parse(localStorage.getItem(GLOBALS_KEY) || "{}") || {}; } catch { return {}; }
}
function saveGlobals(g){ try{ localStorage.setItem(GLOBALS_KEY, JSON.stringify(g)); }catch{} }


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
  const [mode, setMode] = useState("home"); // home | ventilation | hhsrs
  const [theme, setTheme] = useState("light");

  
  const [globals, setGlobals] = useState(() => loadGlobals());
useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
    } catch {}
  }, []);

  
  function updateGlobals(patch){
    setGlobals((prev)=>{
      const next = { ...(prev||{}), ...(patch||{}) };
      saveGlobals(next);
      return next;
    });
  }
  function resetGlobals(){
    if (!confirm("Reset company + job details (this device only)?")) return;
    try { localStorage.removeItem(GLOBALS_KEY); } catch {}
    setGlobals({});
    alert("Reset complete. You can set company details again.");
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  const headerRight = (
    <div className="actions">
      <ThemeToggle theme={theme} setTheme={setTheme} />
      {mode !== "home" ? (
        <button className="btn secondary" type="button" onClick={() => setMode("home")}>
          ← Change survey
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="container">
      {mode === "home" ? (
        <div className="card">
          <div className="topbar">
            <div>
              <div className="kicker">Survey suite</div>
              <div className="h1">Select a survey type</div>
              <div className="small">
                Choose what you’re inspecting today. Each survey has its own workflow and PDF output.
              </div>
            </div>
            <div className="actions">
              <ThemeToggle theme={theme} setTheme={setTheme} />
            </div>
          </div>

          <div className="hr" />

          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ gridColumn: "span 6" }}>
              <label>Company name (used on all surveys & PDFs)</label>
              <input
                value={globals.companyName || ""}
                onChange={(e) => updateGlobals({ companyName: e.target.value })}
                placeholder="e.g., Your Company Ltd"
              />
            </div>

            <div className="field" style={{ gridColumn: "span 6" }}>
              <label>Company logo (used on all surveys & PDFs)</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const r = new FileReader();
                  r.onload = () => updateGlobals({ logoDataUrl: r.result });
                  r.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <div className="mini">Stored locally in your browser. Not uploaded anywhere.</div>
            </div>

            <div className="field" style={{ gridColumn: "span 4" }}>
              <label>Project Site Name</label>
              <input
                value={globals.job?.siteName || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), siteName: e.target.value } })}
                placeholder="Optional"
              />
            </div>
            <div className="field" style={{ gridColumn: "span 4" }}>
              <label>Property reference</label>
              <input
                value={globals.job?.propertyRef || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), propertyRef: e.target.value } })}
                placeholder="e.g., REF-00123"
              />
            </div>
            <div className="field" style={{ gridColumn: "span 4" }}>
              <label>Survey date</label>
              <input
                type="date"
                value={globals.job?.surveyDate || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), surveyDate: e.target.value } })}
              />
            </div>
            <div className="field" style={{ gridColumn: "span 8" }}>
              <label>Property address</label>
              <input
                value={globals.job?.address || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), address: e.target.value } })}
                placeholder="e.g., 12 Every Street"
              />
            </div>
            <div className="field" style={{ gridColumn: "span 4" }}>
              <label>Postcode</label>
              <input
                value={globals.job?.postcode || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), postcode: e.target.value } })}
                placeholder="e.g., BL3 1BZ"
              />
            </div>
            <div className="field" style={{ gridColumn: "span 6" }}>
              <label>Surveyor / Assessor name</label>
              <input
                value={globals.job?.surveyor || ""}
                onChange={(e) => updateGlobals({ job: { ...(globals.job || {}), surveyor: e.target.value } })}
                placeholder="e.g., Seb"
              />
            </div>
            <div className="field" style={{ gridColumn: "span 6", display:"flex", alignItems:"end", gap:10 }}>
              <button className="btn danger" type="button" onClick={resetGlobals}>
                Reset company & job details
              </button>
            </div>
          </div>

          <div className="hr" />

          <div className="row">
            <div className="field" style={{ gridColumn: "span 6" }}>
              <div className="card" style={{ background: "linear-gradient(180deg,#ffffff,#f8fafc)" }}>
                <div className="h2">Ventilation / Damp / Mould</div>
                <div className="small" style={{ marginTop: 6 }}>
                  Room-by-room capture with optional windows/doors/conditions, wet-room ventilation checks and evidence photos.
                  Generates a client PDF.
                </div>
                <div style={{ height: 12 }} />
                <button className="btn" onClick={() => setMode("ventilation")}>Start Ventilation Survey</button>
              </div>
            </div>

            <div className="field" style={{ gridColumn: "span 6" }}>
              <div className="card" style={{ background: "linear-gradient(180deg,#ffffff,#f8fafc)" }}>
                <div className="h2">HHSRS Calculator</div>
                <div className="small" style={{ marginTop: 6 }}>
                  29 hazard list with likelihood/outcome scoring and a summary report PDF.
                  (You can swap in your exact model later.)
                </div>
                <div style={{ height: 12 }} />
                <button className="btn" onClick={() => setMode("hhsrs")}>Start HHSRS Survey</button>
              </div>
            </div>
          </div>
        </div>
      ) : mode === "ventilation" ? (
        <>
          <div style={{ height: 0 }} />
          <VentilationApp />
          <div style={{ height: 12 }} />
          <div className="card">{headerRight}</div>
        </>
      ) : mode === "hhsrs" ? (
        <>
          {headerRight}
          <div style={{ height: 12 }} />
          <HhsrsApp headerRight={null} />
        </>
      ) : null}

      <div style={{ height: 16 }} />
      <div className="small" style={{ textAlign: "center", opacity: 0.85 }}>
        Survey Suite • v1.3 • Switch surveys from the home screen • Theme: {theme}
      </div>
    </div>
  );
}
