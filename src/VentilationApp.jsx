import { useEffect, useMemo, useState } from "react";
import jsPDF from "jspdf";
import placeholderLogo from "./assets/placeholder-logo.png";
const GLOBALS_KEY = "survey_suite_globals_v1";
function loadGlobals(){ try { return JSON.parse(localStorage.getItem(GLOBALS_KEY) || "{}") || {}; } catch { return {}; } }

const WET_USES = ["Kitchen", "Bathroom", "WC", "Utility"];
const WINDOW_MATERIALS = ["Timber", "uPVC", "Other"];
const DOOR_MATERIALS = ["Timber", "uPVC", "Other"];
const GLAZING_TYPES = [
  "Single",
  "Secondary glazing",
  "Double glazing - pre-2002 (E&W)",
  "Double glazing - 2002-2021 (E&W)",
  "Double glazing - 2022+ (E&W)",
  "Double glazing - No data available",
  "Triple glazing",
  "Triple glazing - No data available",
  "Unknown",
];

const num = (v) => {
  const x = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};
const fmt3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);
const fmt2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const mm2ToM2 = (mm2) => mm2 / 1_000_000;
const angleFactor = (angle) => (angle === ">30" ? 1 : angle === "15–30" ? 0.5 : 0.25);

function ventilationStatus(volumeM3, effectiveVentM2, mechOk) {
  if (mechOk) return { label: "Adequate", level: "green", ratio: 0 };
  const ratio = volumeM3 > 0 ? effectiveVentM2 / volumeM3 : 0;
  if (ratio >= 0.03) return { label: "Adequate", level: "green", ratio };
  if (ratio >= 0.015) return { label: "Marginal", level: "amber", ratio };
  return { label: "Inadequate", level: "red", ratio };
}

function roomRisk({ vent, visibleMould, condensation, dampEvidence, roomUse }) {
  let score = 0;
  if (vent === "Inadequate") score += 4;
  else if (vent === "Marginal") score += 2;
  if (visibleMould === "Yes") score += 4;
  if (condensation === "Yes") score += 2;
  if (dampEvidence === "Yes") score += 2;
  if (["Bedroom", "Living Room", "Nursery"].includes(roomUse)) score += 1;
  if (score >= 8) return { band: "High", level: "red", score };
  if (score >= 4) return { band: "Medium", level: "amber", score };
  return { band: "Low", level: "green", score };
}

function suggestedMinRateLs(roomUse, hoodToOutside) {
  if (roomUse === "Kitchen") return hoodToOutside === "Yes" ? 30 : 60;
  if (roomUse === "Utility") return 30;
  if (roomUse === "Bathroom") return 15;
  if (roomUse === "WC") return 6;
  return 0;
}

async function filesToDataUrls(fileList) {
  const files = Array.from(fileList || []);
  const toJpegDataUrl = (dataUrl, maxW = 1400, quality = 0.78) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxW ? maxW / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  const readOne = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const original = String(reader.result || "");
        const jpeg =
          file.type?.includes("jpeg") || file.type?.includes("jpg")
            ? original
            : await toJpegDataUrl(original);
        resolve({ name: file.name, type: "image/jpeg", dataUrl: jpeg });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  return Promise.all(files.map(readOne));
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Math.random());

const emptyRoom = () => ({
  id: uid(),
  name: "",
  use: "Bedroom",
  dims: { width: "", length: "", height: "" },

  includeWindows: true,
  windowMaterial: "uPVC",
  windowMaterialOther: "",
  glazingType: "Double glazing - No data available",
  windowFrame: { width: "", height: "" },
  windowOpening: { width: "", height: "", angle: ">30" },
  fixedVent: { widthMm: "", heightMm: "" },
  windowPhotos: [],

  includeDoors: false,
  door: {
    position: "",
    type: "",
    material: "Timber",
    materialOther: "",
    width: "",
    height: "",
    undercutMm: "",
  },
  doorPhotos: [],

  includeConditions: false,
  visibleMould: "No",
  condensation: "No",
  dampEvidence: "No",
  moistureReading: "",
  conditionPhotos: [],

  mech: {
    present: "No",
    systemType: "Intermittent extract",
    hoodToOutside: "Yes",
    minRateLs: "",
    measuredRateLs: "",
    operational: "Yes",
    manufacturer: "",
    model: "",
    ductDiaMm: "",
    controls: "",
    notes: "",
  },

  observations: "",
});

function riskColors(level) {
  if (level === "red") return { fill: [254, 243, 242], stroke: [254, 205, 202], text: [180, 35, 24] };
  if (level === "amber") return { fill: [255, 250, 235], stroke: [254, 223, 137], text: [181, 71, 8] };
  return { fill: [236, 253, 243], stroke: [171, 239, 198], text: [6, 118, 71] };
}

export default function VentilationApp() {
  const globals = loadGlobals();

  const [branding, setBranding] = useState({ companyName: "", logoDataUrl: "" });

// Persist branding so company name/logo stay after refresh
useEffect(() => {
  try {
    const raw = localStorage.getItem("vd_branding_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setBranding({
          companyName: String(parsed.companyName || ""),
          logoDataUrl: String(parsed.logoDataUrl || ""),
        });
      }
    }
  } catch {
    // ignore
  }
}, []);

useEffect(() => {
  try {
    localStorage.setItem("vd_branding_v1", JSON.stringify(branding));
  } catch {
    // localStorage may be full (logo too large)
  }
}, [branding]);


  const [property, setProperty] = useState({
    address: "",
    postcode: "",
    clientName: "",
    surveyorName: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const [includeFloorPlan, setIncludeFloorPlan] = useState(false);
  const [floorPlanPhotos, setFloorPlanPhotos] = useState([]);

  const [rooms, setRooms] = useState([emptyRoom()]);
  const [conclusions, setConclusions] = useState({
    summary: "",
    actions: "",
    signature: "",
  });
  const [errors, setErrors] = useState([]);

  const computed = useMemo(() => {
    const roomComputed = rooms.map((r) => {
      const area = num(r.dims.width) * num(r.dims.length);
      const vol = area * num(r.dims.height);

      const wfArea = r.includeWindows ? num(r.windowFrame.width) * num(r.windowFrame.height) : 0;

      const woAreaRaw =
        r.includeWindows
          ? num(r.windowOpening.width) * num(r.windowOpening.height)
          : 0;
      const woAreaEff = r.includeWindows
        ? woAreaRaw * angleFactor(r.windowOpening.angle)
        : 0;

      const fixedMm2 =
        r.includeWindows
          ? num(r.fixedVent.widthMm) * num(r.fixedVent.heightMm)
          : 0;
      const fixedM2 = mm2ToM2(fixedMm2);

      const effectiveVentM2 = woAreaEff + fixedM2;

      const isWet = WET_USES.includes(r.use);
      const minSuggested = isWet
        ? suggestedMinRateLs(r.use, r.mech.hoodToOutside)
        : 0;
      const mechMin = num(r.mech.minRateLs || minSuggested);
      const mechMeasured = num(r.mech.measuredRateLs);

      const mechOk =
        isWet &&
        r.mech.present === "Yes" &&
        r.mech.operational === "Yes" &&
        mechMin > 0 &&
        mechMeasured >= mechMin;

      const vent = ventilationStatus(vol, effectiveVentM2, mechOk);

      const risk = roomRisk({
        vent: vent.label,
        visibleMould: r.visibleMould,
        condensation: r.condensation,
        dampEvidence: r.dampEvidence,
        roomUse: r.use,
      });

      const needsConditionEvidence =
        r.includeConditions &&
        (r.visibleMould === "Yes" || r.condensation === "Yes");

      return {
        area,
        vol,
        wfArea,
        woAreaRaw,
        woAreaEff,
        fixedMm2,
        fixedM2,
        effectiveVentM2,
        vent,
        risk,
        isWet,
        minSuggested,
        mechMin,
        mechMeasured,
        mechOk,
        needsConditionEvidence,
      };
    });

    const order = { Low: 1, Medium: 2, High: 3 };
    const overall = roomComputed.reduce(
      (acc, c) => (order[c.risk.band] > order[acc.band] ? c.risk : acc),
      { band: "Low", level: "green", score: 0 }
    );

    return { roomComputed, overall };
  }, [rooms]);

  const updateRoom = (id, patch) =>
    setRooms((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );

  const updateRoomPath = (id, path, value) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = JSON.parse(JSON.stringify(r));
        const parts = path.split(".");
        let cur = next;
        for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
        cur[parts[parts.length - 1]] = value;
        return next;
      })
    );
  };

  const validate = () => {
    const errs = [];
    if (!property.address.trim()) errs.push("Property address is required.");
    if (!property.postcode.trim()) errs.push("Postcode is required.");
    if (!property.surveyorName.trim()) errs.push("Surveyor name is required.");

    if (includeFloorPlan && !floorPlanPhotos?.length) {
      errs.push("Floor plan is enabled: please upload at least 1 floor plan image.");
    }

    rooms.forEach((r, idx) => {
      const label = `Room ${idx + 1}${r.name ? ` (${r.name})` : ""}`;

      if (r.includeWindows && !r.windowPhotos?.length)
        errs.push(`${label}: window photo evidence is required (Windows enabled).`);

      if (
        r.includeWindows &&
        r.windowMaterial === "Other" &&
        !String(r.windowMaterialOther || "").trim()
      )
        errs.push(`${label}: window material is set to Other, please specify the material.`);

      if (r.includeDoors && !r.doorPhotos?.length)
        errs.push(`${label}: door photo evidence is required (Doors enabled).`);

      if (
        r.includeDoors &&
        r.door.material === "Other" &&
        !String(r.door.materialOther || "").trim()
      )
        errs.push(`${label}: door material is set to Other, please specify the material.`);

      const c = computed.roomComputed[idx];
      if (c?.needsConditionEvidence && !r.conditionPhotos?.length) {
        errs.push(`${label}: mould/condensation is marked YES — photo evidence is required.`);
      }
    });

    return errs;
  };

  const generatePdf = () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length) return;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const pageW = 595;
    const contentW = pageW - margin * 2;
    let y = margin;

    const ensureSpace = (need = 80) => {
      if (y + need > 800) {
        doc.addPage();
        y = margin;
      }
    };

    const line = (t, size = 11, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const split = doc.splitTextToSize(t, contentW);
      doc.text(split, margin, y);
      y += split.length * (size + 3);
    };

    const kv = (k, v) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(k, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(v ?? ""), margin + 210, y);
      y += 16;
    };

    const addPhotos = (title, photos) => {
      line(title, 9, true);
      const imgW = contentW;
      const imgH = imgW * 0.65;
      photos.forEach((p) => {
        ensureSpace(imgH + 44);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(p.name, margin, y + 10);
        try {
          doc.addImage(p.dataUrl, "JPEG", margin, y + 16, imgW, imgH);
        } catch {
          doc.text("(Image could not be embedded)", margin, y + 28);
        }
        y += imgH + 44;
      });
    };

    const overallColors = riskColors(computed.overall.level);

    // -------- Page 1: Cover + Property + Summary (merged) --------
    // Background banner
    doc.setFillColor(245, 247, 255);
    doc.rect(0, 0, pageW, 120, "F");

    if (branding.logoDataUrl) {
      try {
        doc.addImage(branding.logoDataUrl, "PNG", pageW - margin - 180, 26, 180, 44);
      } catch {}
    }
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(branding.companyName?.trim() ? branding.companyName.trim() : "Ventilation & Damp Assessment", margin, 30);

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("Damp, Mould & Ventilation Assessment Report", margin, 52);

    y = 140;
    line("Property Details", 13, true);
    y += 6;
    kv("Property:", property.address);
    kv("Postcode:", property.postcode);
    kv("Client:", property.clientName);
    kv("Surveyor:", property.surveyorName);
    kv("Inspection date:", property.date);

    y += 10;
    // Overall risk badge box
    const boxH = 42;
    doc.setDrawColor(...overallColors.stroke);
    doc.setFillColor(...overallColors.fill);
    doc.roundedRect(margin, y, contentW, boxH, 10, 10, "FD");
    doc.setTextColor(...overallColors.text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(`Overall Damp & Mould Risk Rating: ${computed.overall.band}`, margin + 14, y + 26);
    doc.setTextColor(15, 23, 42);
    y += boxH + 14;

    // Compact per-room table on page 1 (to avoid extra "summary page")
    line("Room Summary", 12, true);
    y += 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("Room", margin, y);
    doc.text("Use", margin + 160, y);
    doc.text("Ventilation", margin + 290, y);
    doc.text("Risk", margin + 430, y);
    y += 10;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, margin + contentW, y);
    y += 10;

    doc.setFont("helvetica", "normal");
    computed.roomComputed.forEach((c, idx) => {
      ensureSpace(18);
      const r = rooms[idx];
      doc.text(String(r.name || `Room ${idx + 1}`), margin, y);
      doc.text(String(r.use || ""), margin + 160, y);
      doc.text(String(c.vent.label), margin + 290, y);
      doc.text(String(c.risk.band), margin + 430, y);
      y += 16;
    });

    // Floor plan section (optional) after summary, still page 1 if space, otherwise next page
    if (includeFloorPlan) {
      ensureSpace(80);
      y += 6;
      line("Floor Plan (optional)", 12, true);
      y += 6;
      addPhotos("Floor plan evidence", floorPlanPhotos);
    }

    // -------- Per-room pages --------
    rooms.forEach((r, idx) => {
      const c = computed.roomComputed[idx];
      doc.addPage();
      y = margin;

      const roomColors = riskColors(c.risk.level);
      doc.setFillColor(248, 250, 252);
      doc.rect(0, 0, pageW, 66, "F");
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.text(`Room: ${r.name || "(unnamed room)"}`, margin, 34);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Use: ${r.use}`, margin, 52);

      // room risk badge
      doc.setDrawColor(...roomColors.stroke);
      doc.setFillColor(...roomColors.fill);
      doc.roundedRect(margin + 330, 22, 225, 32, 10, 10, "FD");
      doc.setTextColor(...roomColors.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(`Risk: ${c.risk.band}`, margin + 344, 43);
      doc.setTextColor(15, 23, 42);

      y = 92;
      line(`Ventilation Assessment: ${c.vent.label}`, 11, true);
      line(`Total effective vent area (m²): ${fmt3(c.effectiveVentM2)}  •  Ratio: ${(c.vent.ratio ?? 0).toFixed(4)}`, 9);

      y += 8;
      line("Measurements", 11, true);
      y += 6;
      kv("Room width (m):", r.dims.width);
      kv("Room length (m):", r.dims.length);
      kv("Room area (m²):", fmt2(c.area));
      kv("Room height (m):", r.dims.height);
      kv("Room volume (m³):", fmt3(c.vol));

      y += 6;
      if (!r.includeWindows) {
        line("Windows", 10, true);
        line("No windows recorded for this room.", 9);
      } else {
        line("Windows", 11, true);
        y += 4;
        const winMat =
          r.windowMaterial === "Other"
            ? r.windowMaterialOther || "Other (not specified)"
            : r.windowMaterial;
        kv("Window frame material:", winMat);
        kv("Glazing type:", r.glazingType);
        kv("Frame width (m):", r.windowFrame.width);
        kv("Frame height (m):", r.windowFrame.height);
        kv("Frame area (m²):", fmt3(c.wfArea));
        y += 4;
        kv("Opening width (m):", r.windowOpening.width);
        kv("Opening height (m):", r.windowOpening.height);
        kv("Opening angle:", r.windowOpening.angle);
        kv("Effective opening area (m²):", fmt3(c.woAreaEff));
        kv("Fixed vent area (mm²):", Math.round(c.fixedMm2));
      }

      if (c.isWet) {
        y += 6;
        line("Ventilation (wet rooms)", 11, true);
        kv("Ventilation present:", r.mech.present);
        if (r.mech.present === "Yes") {
          if (r.use === "Kitchen") kv("Hood extracts to outside:", r.mech.hoodToOutside);
          kv("System type:", r.mech.systemType);
          kv("Operational:", r.mech.operational);
          kv("Minimum extract rate (l/s):", c.mechMin ? c.mechMin : "");
          kv("Measured extract rate (l/s):", r.mech.measuredRateLs);
          kv("Meets minimum rate:", c.mechOk ? "Yes" : "No");
          kv("Manufacturer:", r.mech.manufacturer);
          kv("Model:", r.mech.model);
          kv("Duct diameter (mm):", r.mech.ductDiaMm);
          kv("Controls:", r.mech.controls);
          kv("Notes:", r.mech.notes);
        }
      }

      if (r.includeDoors) {
        y += 6;
        line("Doors", 11, true);
        kv("Door position:", r.door.position);
        kv("Door type:", r.door.type);
        const doorMat =
          r.door.material === "Other"
            ? r.door.materialOther || "Other (not specified)"
            : r.door.material;
        kv("Door material:", doorMat);
        kv("Door undercut (mm):", r.door.undercutMm);
      }

      if (r.includeConditions) {
        y += 6;
        line("Mould / Condensation / Damp", 11, true);
        kv("Visible mould:", r.visibleMould);
        kv("Condensation indicators:", r.condensation);
        kv("Damp evidence:", r.dampEvidence);
        kv("Moisture reading (optional):", r.moistureReading);
      }

      y += 6;
      line("Observations", 10, true);
      line(r.observations || "No observations recorded.", 9);

      y += 6;
      line("Photographic Evidence", 11, true);
      if (r.includeWindows) addPhotos("Window evidence (mandatory when Windows enabled)", r.windowPhotos);
      if (r.includeDoors) addPhotos("Door evidence (mandatory when enabled)", r.doorPhotos);
      if (r.includeConditions && (r.visibleMould === "Yes" || r.condensation === "Yes")) {
        addPhotos("Mould/condensation evidence (mandatory when marked YES)", r.conditionPhotos);
      }
    });

    // -------- Conclusions --------
    doc.addPage();
    y = margin;
    doc.setFillColor(245, 247, 255);
    doc.rect(0, 0, pageW, 90, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Conclusions & Recommendations", margin, 52);
    y = 120;
    line("Summary of Findings", 11, true);
    line(conclusions.summary || "Summary to be completed by the surveyor.", 9);
    y += 8;
    line("Recommended Actions", 11, true);
    line(conclusions.actions || "Recommendations to be completed by the surveyor.", 9);
    y += 14;
    kv("Surveyor:", property.surveyorName);
    kv("Signature:", conclusions.signature || "(signed digitally)");
    kv("Date:", property.date);

    const namePart = branding.companyName?.trim()
      ? branding.companyName.trim().replaceAll(" ", "_") + "_"
      : "";
    doc.save(`${namePart}Ventilation_Report_${property.postcode || "property"}.pdf`);
  };

  const appTitle = branding.companyName?.trim()
    ? branding.companyName.trim()
    : "Ventilation & Damp Assessment";
  const logoSrc = branding.logoDataUrl || placeholderLogo;

  return (
    <div className="container">
      <div className="card">
        <div className="topbar">
          <div className="brand">
            <img src={logoSrc} alt="Company logo" />
            <div>
              <div className="kicker">Inspection tool</div>
              <div className="h1">{appTitle}</div>
              <div className="small">Client output: PDF only • Sections are optional per room</div>
            </div>
          </div>
          <div className="actions">
            <span className={`badge ${computed.overall.level}`}>
              Overall Risk: {computed.overall.band}
            </span>
            <button className="btn" onClick={generatePdf}>Generate Client PDF</button>
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      {errors.length ? (
        <div className="errors">
          <b>Cannot generate PDF yet. Fix the following:</b>
          <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      ) : null}

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="h2">Branding (optional)</div>
        <div className="small" style={{marginTop:6}}>
          Your company name/logo is saved on this device (local). Use reset to clear it.
        </div>
        <div style={{height:10}} />
        <div className="actions">
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              try { localStorage.removeItem("vd_branding_v1"); } catch {}
              setBranding({ companyName: "", logoDataUrl: "" });
            }}
          >
            Reset branding
          </button>
        </div>
        <div className="hr" />
        <div className="row">
          <div className="field" style={{ gridColumn: "span 6" }}>
            <label>Company name (shows on app + PDF cover)</label>
            <input
              value={branding.companyName}
              onChange={(e) => setBranding({ ...branding, companyName: e.target.value })}
              placeholder="e.g. Your Company Ltd"
            />
            <div className="small">
              Font: the app uses <b>Bierstadt</b> if your device has it installed; otherwise it falls back to system fonts.
            </div>
          </div>
          <div className="field" style={{ gridColumn: "span 6" }}>
            <label>Company logo (PNG/JPG) (shows on app + PDF cover)</label>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                const dataUrl = await fileToDataUrl(file);
                setBranding({ ...branding, logoDataUrl: dataUrl });
              }}
            />
            <div className="small">If you don’t upload a logo, the app uses a blank placeholder.</div>
          </div>

          <div className="field" style={{ gridColumn: "span 12" }}>
            <div className="pill">
              <b>Style:</b> light background + professional card layout for better readability
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="h2">Property Details</div>
        <div className="hr" />
        <div className="row">
          <div className="field" style={{ gridColumn: "span 8" }}>
            <label>Property address *</label>
            <input value={property.address} onChange={(e) => setProperty({ ...property, address: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 4" }}>
            <label>Postcode *</label>
            <input value={property.postcode} onChange={(e) => setProperty({ ...property, postcode: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 4" }}>
            <label>Client name</label>
            <input value={property.clientName} onChange={(e) => setProperty({ ...property, clientName: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 4" }}>
            <label>Surveyor name *</label>
            <input value={property.surveyorName} onChange={(e) => setProperty({ ...property, surveyorName: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 4" }}>
            <label>Inspection date</label>
            <input type="date" value={property.date} onChange={(e) => setProperty({ ...property, date: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 12" }}>
            <label>General notes (internal)</label>
            <textarea value={property.notes} onChange={(e) => setProperty({ ...property, notes: e.target.value })} />
          </div>
        </div>
      </div>

      <div style={{ height: 12 }} />

      <div className="card">
        <div className="topbar">
          <div>
            <div className="h2">Floor Plan</div>
            <div className="small">Optional — assessor can include it in the report if needed.</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={includeFloorPlan}
              onChange={(e) => setIncludeFloorPlan(e.target.checked)}
            />
            Include floor plan
          </label>
        </div>
        {includeFloorPlan ? (
          <div className="row" style={{ marginTop: 12 }}>
            <div className="field" style={{ gridColumn: "span 12" }}>
              <label>Floor plan image(s) *</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={async (e) => setFloorPlanPhotos(await filesToDataUrls(e.target.files))}
              />
              <div className="small">
                {floorPlanPhotos?.length ? `${floorPlanPhotos.length} image(s) selected` : "No files selected."}
              </div>
              {floorPlanPhotos?.length ? (
                <div className="thumbs">
                  {floorPlanPhotos.slice(0, 8).map((p) => (
                    <img key={p.name} src={p.dataUrl} alt={p.name} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="help" style={{ marginTop: 12 }}>
            Floor plan is OFF — nothing will be required or added to the PDF.
          </div>
        )}
      </div>

      <div style={{ height: 12 }} />

      {rooms.map((r, idx) => {
        const c = computed.roomComputed[idx];
        return (
          <div className="card" key={r.id} style={{ marginBottom: 12 }}>
            <div className="topbar">
              <div>
                <div className="h2">Room {idx + 1}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  Ventilation: <span className={`badge ${c.vent.level}`}>{c.vent.label}</span>{" "}
                  Risk: <span className={`badge ${c.risk.level}`}>{c.risk.band}</span>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  Area: <b>{fmt2(c.area)} m²</b> • Volume: <b>{fmt3(c.vol)} m³</b> • Effective vent area: <b>{fmt3(c.effectiveVentM2)} m²</b> • Ratio: <b>{(c.vent.ratio ?? 0).toFixed(4)}</b>
                  {c.mechOk ? <> • <b>Ventilation meets minimum rate</b></> : null}
                </div>
              </div>
              <div className="actions">
                <button className="btn secondary" onClick={() => setRooms((p) => [...p, emptyRoom()])}>+ Add room</button>
                <button className="btn danger" onClick={() => setRooms((p) => (p.length <= 1 ? p : p.filter((x) => x.id !== r.id)))}>Remove</button>
              </div>
            </div>

            <div className="hr" />

            <div className="row">
              <div className="field" style={{ gridColumn: "span 6" }}>
                <label>Room name</label>
                <input value={r.name} onChange={(e) => updateRoom(r.id, { name: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "span 6" }}>
                <label>Room use</label>
                <select value={r.use} onChange={(e) => updateRoom(r.id, { use: e.target.value })}>
                  <option>Bedroom</option><option>Living Room</option><option>Kitchen</option>
                  <option>Bathroom</option><option>WC</option><option>Utility</option>
                  <option>Hall</option><option>Nursery</option><option>Other</option>
                </select>
              </div>

              <div className="field" style={{ gridColumn: "span 12" }}>
                <div className="sectionNote">
                  <b>Optional capture (switch ON to show the section and include it in the PDF):</b>
                  <div style={{ height: 8 }} />
                  <div className="toggles">
                    <label className="toggle">
                      <input type="checkbox" checked={!!r.includeWindows} onChange={(e) => updateRoom(r.id, { includeWindows: e.target.checked })} />
                      Windows
                    </label>
                    <label className="toggle">
                      <input type="checkbox" checked={!!r.includeDoors} onChange={(e) => updateRoom(r.id, { includeDoors: e.target.checked })} />
                      Doors
                    </label>
                    <label className="toggle">
                      <input type="checkbox" checked={!!r.includeConditions} onChange={(e) => updateRoom(r.id, { includeConditions: e.target.checked })} />
                      Mould / Condensation / Damp
                    </label>
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>
                    Tip: If a room has <b>no windows</b>, switch Windows OFF so the app won’t require window evidence.
                  </div>
                </div>
              </div>

              <div className="field" style={{ gridColumn: "span 4" }}>
                <label>Room width (m)</label>
                <input value={r.dims.width} onChange={(e) => updateRoomPath(r.id, "dims.width", e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn: "span 4" }}>
                <label>Room length (m)</label>
                <input value={r.dims.length} onChange={(e) => updateRoomPath(r.id, "dims.length", e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn: "span 4" }}>
                <label>Room height (m)</label>
                <input value={r.dims.height} onChange={(e) => updateRoomPath(r.id, "dims.height", e.target.value)} />
              </div>

              {r.includeWindows ? (
                <>
                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <div className="h2">Windows</div>
                    <div className="hr" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Window frame material</label>
                    <select value={r.windowMaterial} onChange={(e) => updateRoom(r.id, { windowMaterial: e.target.value })}>
                      {WINDOW_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  {r.windowMaterial === "Other" ? (
                    <div className="field" style={{ gridColumn: "span 8" }}>
                      <label>Window material (other) *</label>
                      <input value={r.windowMaterialOther} onChange={(e) => updateRoom(r.id, { windowMaterialOther: e.target.value })} placeholder="e.g. Aluminium / Composite / Steel" />
                    </div>
                  ) : (
                    <div className="field" style={{ gridColumn: "span 8" }}>
                      <label>Glazing type (RdSAP options)</label>
                      <select value={r.glazingType} onChange={(e) => updateRoom(r.id, { glazingType: e.target.value })}>
                        {GLAZING_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  )}

                  {r.windowMaterial === "Other" ? (
                    <div className="field" style={{ gridColumn: "span 12" }}>
                      <label>Glazing type (RdSAP options)</label>
                      <select value={r.glazingType} onChange={(e) => updateRoom(r.id, { glazingType: e.target.value })}>
                        {GLAZING_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  ) : null}

                  
                  <div className="field" style={{ gridColumn: "span 6" }}>
                    <label>Window frame width (m)</label>
                    <input value={r.windowFrame.width} onChange={(e) => updateRoomPath(r.id, "windowFrame.width", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 6" }}>
                    <label>Window frame height (m)</label>
                    <input value={r.windowFrame.height} onChange={(e) => updateRoomPath(r.id, "windowFrame.height", e.target.value)} />
                    <div className="small">Frame area: <b>{fmt3(c.wfArea)} m²</b></div>
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Window opening width (m)</label>
                    <input value={r.windowOpening.width} onChange={(e) => updateRoomPath(r.id, "windowOpening.width", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Window opening height (m)</label>
                    <input value={r.windowOpening.height} onChange={(e) => updateRoomPath(r.id, "windowOpening.height", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Opening angle</label>
                    <select value={r.windowOpening.angle} onChange={(e) => updateRoomPath(r.id, "windowOpening.angle", e.target.value)}>
                      <option value=">30">{">30"}</option>
                      <option value="15–30">{"15–30"}</option>
                      <option value="<15">{"<15"}</option>
                    </select>
                  </div>

                  <div className="field" style={{ gridColumn: "span 6" }}>
                    <label>Fixed vent width (mm)</label>
                    <input value={r.fixedVent.widthMm} onChange={(e) => updateRoomPath(r.id, "fixedVent.widthMm", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 6" }}>
                    <label>Fixed vent height (mm)</label>
                    <input value={r.fixedVent.heightMm} onChange={(e) => updateRoomPath(r.id, "fixedVent.heightMm", e.target.value)} />
                  </div>

                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <label>Window photo evidence * (mandatory when Windows enabled)</label>
                    <input type="file" multiple accept="image/*" onChange={async (e) => updateRoom(r.id, { windowPhotos: await filesToDataUrls(e.target.files) })} />
                    <div className="small">{r.windowPhotos?.length ? `${r.windowPhotos.length} photo(s) selected` : "No files selected."}</div>
                    {r.windowPhotos?.length ? <div className="thumbs">{r.windowPhotos.slice(0, 6).map((p) => <img key={p.name} src={p.dataUrl} alt={p.name} />)}</div> : null}
                  </div>
                </>
              ) : (
                <div className="field" style={{ gridColumn: "span 12" }}>
                  <div className="help">
                    <b>Windows switched OFF for this room.</b><br/>
                    The app will not require window measurements or window photo evidence.
                  </div>
                </div>
              )}

              {c.isWet ? (
                <div className="field" style={{ gridColumn: "span 12" }}>
                  <div className="help">
                    <b>Approved Document F quick reference (wet rooms):</b><br/>
                    Intermittent extract minima: Kitchen 30 l/s (hood to outside) or 60 l/s (no hood to outside), Utility 30 l/s, Bathroom 15 l/s, WC 6 l/s.
                  </div>
                </div>
              ) : null}

              {c.isWet ? (
                <>
                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <div className="h2">Ventilation (wet rooms)</div>
                    <div className="hr" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 3" }}>
                    <label>Present</label>
                    <select value={r.mech.present} onChange={(e) => updateRoomPath(r.id, "mech.present", e.target.value)}>
                      <option>No</option><option>Yes</option>
                    </select>
                  </div>

                  <div className="field" style={{ gridColumn: "span 3" }}>
                    <label>System type</label>
                    <select value={r.mech.systemType} onChange={(e) => updateRoomPath(r.id, "mech.systemType", e.target.value)}>
                      <option>Natural</option>
                      <option>Intermittent extract</option>
                      <option>dMEV</option>
                      <option>MEV</option>
                      <option>MVHR</option>
                      <option>Other</option>
                    </select>
                  </div>

                  {r.use === "Kitchen" ? (
                    <div className="field" style={{ gridColumn: "span 3" }}>
                      <label>Hood extracts to outside</label>
                      <select
                        value={r.mech.hoodToOutside}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateRoomPath(r.id, "mech.hoodToOutside", v);
                          if (!r.mech.minRateLs) updateRoomPath(r.id, "mech.minRateLs", String(suggestedMinRateLs(r.use, v)));
                        }}
                      >
                        <option>Yes</option><option>No</option>
                      </select>
                    </div>
                  ) : null}

                  <div className="field" style={{ gridColumn: "span 3" }}>
                    <label>Operational</label>
                    <select value={r.mech.operational} onChange={(e) => updateRoomPath(r.id, "mech.operational", e.target.value)}>
                      <option>Yes</option><option>No</option>
                    </select>
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Minimum extract rate (l/s)</label>
                    <input value={r.mech.minRateLs} onChange={(e) => updateRoomPath(r.id, "mech.minRateLs", e.target.value)} placeholder={String(c.minSuggested || "")} />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Measured extract rate (l/s)</label>
                    <input value={r.mech.measuredRateLs} onChange={(e) => updateRoomPath(r.id, "mech.measuredRateLs", e.target.value)} />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Duct diameter (mm)</label>
                    <input value={r.mech.ductDiaMm} onChange={(e) => updateRoomPath(r.id, "mech.ductDiaMm", e.target.value)} />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Manufacturer</label>
                    <input value={r.mech.manufacturer} onChange={(e) => updateRoomPath(r.id, "mech.manufacturer", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Model</label>
                    <input value={r.mech.model} onChange={(e) => updateRoomPath(r.id, "mech.model", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Controls</label>
                    <input value={r.mech.controls} onChange={(e) => updateRoomPath(r.id, "mech.controls", e.target.value)} placeholder="e.g. timer / humidistat / pull cord" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <label>Ventilation notes</label>
                    <textarea value={r.mech.notes} onChange={(e) => updateRoomPath(r.id, "mech.notes", e.target.value)} />
                  </div>
                </>
              ) : null}

              {r.includeDoors ? (
                <>
                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <div className="h2">Doors</div>
                    <div className="hr" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Door position</label>
                    <input value={r.door.position} onChange={(e) => updateRoomPath(r.id, "door.position", e.target.value)} placeholder="e.g. Hall to Kitchen" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Door type</label>
                    <input value={r.door.type} onChange={(e) => updateRoomPath(r.id, "door.type", e.target.value)} placeholder="e.g. Internal / External / Fire door" />
                  </div>

                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Door material</label>
                    <select value={r.door.material} onChange={(e) => updateRoomPath(r.id, "door.material", e.target.value)}>
                      {DOOR_MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>

                  {r.door.material === "Other" ? (
                    <div className="field" style={{ gridColumn: "span 12" }}>
                      <label>Door material (other) *</label>
                      <input value={r.door.materialOther} onChange={(e) => updateRoomPath(r.id, "door.materialOther", e.target.value)} placeholder="e.g. Composite / Aluminium / Steel" />
                    </div>
                  ) : null}

                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label>Door width (m)</label>
                    <input value={r.door.width} onChange={(e) => updateRoomPath(r.id, "door.width", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label>Door height (m)</label>
                    <input value={r.door.height} onChange={(e) => updateRoomPath(r.id, "door.height", e.target.value)} />
                  </div>
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label>Door undercut (mm)</label>
                    <input value={r.door.undercutMm} onChange={(e) => updateRoomPath(r.id, "door.undercutMm", e.target.value)} />
                  </div>

                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <label>Door photo evidence * (mandatory when Doors enabled)</label>
                    <input type="file" multiple accept="image/*" onChange={async (e) => updateRoom(r.id, { doorPhotos: await filesToDataUrls(e.target.files) })} />
                    <div className="small">{r.doorPhotos?.length ? `${r.doorPhotos.length} photo(s) selected` : "No files selected."}</div>
                    {r.doorPhotos?.length ? <div className="thumbs">{r.doorPhotos.slice(0, 6).map((p) => <img key={p.name} src={p.dataUrl} alt={p.name} />)}</div> : null}
                  </div>
                </>
              ) : null}

              {r.includeConditions ? (
                <>
                  <div className="field" style={{ gridColumn: "span 12" }}>
                    <div className="h2">Mould / Condensation / Damp</div>
                    <div className="hr" />
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Visible mould</label>
                    <select value={r.visibleMould} onChange={(e) => updateRoom(r.id, { visibleMould: e.target.value })}><option>No</option><option>Yes</option></select>
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Condensation indicators</label>
                    <select value={r.condensation} onChange={(e) => updateRoom(r.id, { condensation: e.target.value })}><option>No</option><option>Yes</option></select>
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Damp evidence</label>
                    <select value={r.dampEvidence} onChange={(e) => updateRoom(r.id, { dampEvidence: e.target.value })}><option>No</option><option>Yes</option></select>
                  </div>
                  <div className="field" style={{ gridColumn: "span 4" }}>
                    <label>Moisture reading (optional)</label>
                    <input value={r.moistureReading} onChange={(e) => updateRoom(r.id, { moistureReading: e.target.value })} />
                  </div>

                  {(r.visibleMould === "Yes" || r.condensation === "Yes") ? (
                    <div className="field" style={{ gridColumn: "span 12" }}>
                      <label>Mould/condensation photo evidence * (mandatory when marked YES)</label>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={async (e) => updateRoom(r.id, { conditionPhotos: await filesToDataUrls(e.target.files) })}
                      />
                      <div className="small">
                        {r.conditionPhotos?.length ? `${r.conditionPhotos.length} photo(s) selected` : "No files selected."}
                      </div>
                      {r.conditionPhotos?.length ? (
                        <div className="thumbs">
                          {r.conditionPhotos.slice(0, 6).map((p) => <img key={p.name} src={p.dataUrl} alt={p.name} />)}
                        </div>
                      ) : null}
                      <div className="help" style={{ marginTop: 8 }}>
                        Because mould/condensation is marked <b>YES</b>, evidence photos are required before you can generate the PDF.
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              <div className="field" style={{ gridColumn: "span 12" }}>
                <label>Room observations (internal)</label>
                <textarea value={r.observations} onChange={(e) => updateRoom(r.id, { observations: e.target.value })} />
              </div>
            </div>
          </div>
        );
      })}

      <div className="card">
        <div className="h2">Conclusions & Recommendations (client report)</div>
        <div className="hr" />
        <div className="row">
          <div className="field" style={{ gridColumn: "span 12" }}>
            <label>Summary of findings (client-facing)</label>
            <textarea value={conclusions.summary} onChange={(e) => setConclusions({ ...conclusions, summary: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 12" }}>
            <label>Recommended actions (client-facing)</label>
            <textarea value={conclusions.actions} onChange={(e) => setConclusions({ ...conclusions, actions: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 6" }}>
            <label>Signature (typed)</label>
            <input value={conclusions.signature} onChange={(e) => setConclusions({ ...conclusions, signature: e.target.value })} />
          </div>
          <div className="field" style={{ gridColumn: "span 6", alignSelf: "end" }}>
            <button className="btn" onClick={generatePdf} style={{ width: "100%" }}>Generate Client PDF</button>
          </div>
        </div>
      </div>

      <div style={{ height: 16 }} />
      <div className="small" style={{ textAlign: "center", opacity: 0.85 }}>
        Generic Ventilation & Damp Assessment Tool • v8.0 • Client output: PDF only
      </div>
    </div>
  );
}
