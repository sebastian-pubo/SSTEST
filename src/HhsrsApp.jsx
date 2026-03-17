import { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import { DEFAULT_HAZARD_STATS } from "./hhsrs/hazardStats.js";
import { HHSRS_STANDARD_TEXT, getLegalRefs, LIKELIHOOD_POINTS } from "./hhsrs/legalRefs.js";
const GLOBALS_KEY = "survey_suite_globals_v1";
function loadGlobals(){ try { return JSON.parse(localStorage.getItem(GLOBALS_KEY) || "{}") || {}; } catch { return {}; } }

const LS_KEY_REPORT = "hhsrs_report_1_29_v1_1";
const LS_KEY_SETTINGS = "hhsrs_settings_1_29_v1_1";

function fmt(n, digits = 0) {
  if (n === null || n === undefined || !isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function bandFromScore(score) {
  if (score >= 5000) return "A";
  if (score >= 2000) return "B";
  if (score >= 1000) return "C";
  if (score >= 500) return "D";
  if (score >= 200) return "E";
  if (score >= 100) return "F";
  if (score >= 50) return "G";
  if (score >= 20) return "H";
  if (score >= 10) return "I";
  return "J";
}
function categoryFromBand(band) {
  return band === "A" || band === "B" || band === "C" ? "Category 1" : "Category 2";
}

// Score = (10000/L)*CI + (1000/L)*CII + (300/L)*CIII + (10/L)*CIV
function computeScore(L, c1, c2, c3) {
  const c4 = Math.max(0, 100 - (c1 + c2 + c3));
  const parts = [
    { cls: "Class I", w: 10000, pct: c1, val: (10000 / L) * c1 },
    { cls: "Class II", w: 1000, pct: c2, val: (1000 / L) * c2 },
    { cls: "Class III", w: 300, pct: c3, val: (300 / L) * c3 },
    { cls: "Class IV", w: 10, pct: c4, val: (10 / L) * c4 },
  ];
  const total = parts.reduce((s, p) => s + p.val, 0);
  return { total, c4, parts };
}

function defaultProfileIndex(hz) {
  const idx = hz.profiles.findIndex((p) => String(p.segment || "").toLowerCase().includes("all dwellings"));
  return idx >= 0 ? idx : 0;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HhsrsApp({ headerRight }) {
  const globals = loadGlobals();

const [hazardStats, setHazardStats] = useState(() => {
  try {
    const raw = localStorage.getItem("hhsrs_hazard_stats_v1_1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return DEFAULT_HAZARD_STATS;
});

  const hazardKeys = useMemo(() => Object.keys(hazardStats).sort((a, b) => Number(a) - Number(b)), []);

  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_SETTINGS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [report, setReport] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY_REPORT);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [hazardNo, setHazardNo] = useState("1");
  const hz = hazardStats[hazardNo] || hazardStats["1"];
  const [profileIdx, setProfileIdx] = useState(() => defaultProfileIndex(hz));

  // NEW: profile filters (to match Annex D tables by age band + dwelling type)
  const AGE_BANDS = ["All dwellings", "Pre 1920", "1920–1945", "1946–1979", "Post 1979"];
  const PROPERTY_TYPES = ["All", "Non HMO", "HMO", "House", "Flat"];
  const [ageBand, setAgeBand] = useState("All dwellings");
  const [propertyType, setPropertyType] = useState("All");

  function normSegment(seg) {
    const s = String(seg || "")
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();

    // type
    let type = "unknown";
    if (s.includes("all dwell")) type = "all";
    else if (s.includes("non") && s.includes("hmo")) type = "non_hmo";
    else if (s.includes("hmo")) type = "hmo";
    else if (s.includes("house")) type = "house";
    else if (s.includes("flat")) type = "flat";

    // age
    let age = "all";
    if (s.includes("pre 1920") || s.includes("pre-1920") || s.includes("pre1920")) age = "pre1920";
    else if (s.includes("1920") && (s.includes("-45") || s.includes("1945") || s.includes("to 45") || s.includes("1920-45"))) age = "1920_45";
    else if (s.includes("1946") && (s.includes("-79") || s.includes("1979") || s.includes("1946-79"))) age = "1946_79";
    else if (s.includes("post 1979") || (s.includes("post") && s.includes("1979"))) age = "post1979";
    else if (s.includes("all ages") || s.includes("all age")) age = "all";

    return { type, age };
  }

  function wantTypeKey(pt) {
    if (pt === "Non HMO") return "non_hmo";
    if (pt === "HMO") return "hmo";
    if (pt === "House") return "house";
    if (pt === "Flat") return "flat";
    return "all";
  }

  function wantAgeKey(ab) {
    if (ab === "Pre 1920") return "pre1920";
    if (ab === "1920–1945") return "1920_45";
    if (ab === "1946–1979") return "1946_79";
    if (ab === "Post 1979") return "post1979";
    return "all";
  }

  function profileMatches(p, ab, pt) {
    const { type, age } = normSegment(p.segment);
    const wantT = wantTypeKey(pt);
    const wantA = wantAgeKey(ab);

    const typeOk = wantT === "all" ? true : type === wantT;
    const ageOk = wantA === "all" ? true : age === wantA;
    return typeOk && ageOk;
  }

  const filteredProfiles = useMemo(() => {
    if (!hz?.profiles?.length) return [];
    const withIdx = hz.profiles.map((p, idx) => ({ ...p, _idx: idx }));
    const matches = withIdx.filter((p) => profileMatches(p, ageBand, propertyType));
    return matches.length ? matches : withIdx;
  }, [hazardNo, ageBand, propertyType, hazardStats]);

  function findBestProfileIndex(hzObj, ab, pt) {
    if (!hzObj?.profiles?.length) return 0;
    const wantA = wantAgeKey(ab);
    const wantT = wantTypeKey(pt);
    // 1) exact match
    let idx = hzObj.profiles.findIndex((p) => {
      const n = normSegment(p.segment);
      const typeOk = wantT === "all" ? n.type === "all" || n.type === "unknown" : n.type === wantT;
      const ageOk = wantA === "all" ? n.age === "all" : n.age === wantA;
      return typeOk && ageOk;
    });
    if (idx >= 0) return idx;
    // 2) age match, any type
    if (wantA !== "all") {
      idx = hzObj.profiles.findIndex((p) => normSegment(p.segment).age === wantA);
      if (idx >= 0) return idx;
    }
    // 3) type match, any age
    if (wantT !== "all") {
      idx = hzObj.profiles.findIndex((p) => normSegment(p.segment).type === wantT);
      if (idx >= 0) return idx;
    }
    // 4) all dwellings
    return defaultProfileIndex(hzObj);
  }

  // form fields
  const [clientName, setClientName] = useState("");
  const [propertyRef, setPropertyRef] = useState("");
  const [address, setAddress] = useState("");
  const [surveyDate, setSurveyDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [surveyor, setSurveyor] = useState("");

  const [items, setItems] = useState("");
  const [justification, setJustification] = useState("");

  const [likelihoodPreset, setLikelihoodPreset] = useState(String(LIKELIHOOD_POINTS[5])); // 320
  const [likelihoodCustom, setLikelihoodCustom] = useState("");
  const [c1, setC1] = useState(0);
  const [c2, setC2] = useState(0.2);
  const [c3, setC3] = useState(2.2);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settings));
    } catch {}
  }, [settings]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_REPORT, JSON.stringify(report));
    } catch {}
  }, [report]);

  // apply settings into form on load
  useEffect(() => {
    setClientName(settings.clientName || "");
    setPropertyRef(settings.propertyRef || "");
    setAddress(settings.address || "");
    setSurveyDate(settings.surveyDate || new Date().toISOString().slice(0, 10));
    setSurveyor(settings.surveyor || "");
  }, []); // eslint-disable-line

  // when hazard/filters change, select the best matching Annex D profile
  useEffect(() => {
    const hzNew = hazardStats[hazardNo];
    if (!hzNew) return;
    const idx = findBestProfileIndex(hzNew, ageBand, propertyType);
    setProfileIdx(idx);
  }, [hazardNo, ageBand, propertyType, hazardStats]);

  // apply profile
  useEffect(() => {
    const hzNow = hazardStats[hazardNo];
    if (!hzNow) return;
    const p = hzNow.profiles[Number(profileIdx)] || hzNow.profiles[defaultProfileIndex(hzNow)];
    setLikelihoodPreset(String(p.likelihood));
    setLikelihoodCustom("");
    setC1(Number(p.classI) || 0);
    setC2(Number(p.classII) || 0);
    setC3(Number(p.classIII) || 0);
  }, [hazardNo, profileIdx]);

  function captureMetaToSettings() {
    setSettings((s) => ({
      ...s,
      clientName,
      propertyRef,
      address,
      surveyDate,
      surveyor,
    }));
  }

  function getLikelihood() {
    const custom = Number(likelihoodCustom);
    if (likelihoodCustom !== "" && isFinite(custom) && custom > 0) return custom;
    const preset = Number(likelihoodPreset);
    return isFinite(preset) && preset > 0 ? preset : 320;
  }

  const live = useMemo(() => {
    const L = getLikelihood();
    const sum123 = Number(c1) + Number(c2) + Number(c3);
    const { total, c4, parts } = computeScore(L, Number(c1) || 0, Number(c2) || 0, Number(c3) || 0);
    const score = Math.round(total);
    const band = bandFromScore(score);
    const category = categoryFromBand(band);
    return {
      L,
      sum123,
      c4,
      parts,
      score,
      band,
      category,
      probPct: (1 / L) * 100,
      profileName: (hz?.profiles?.[Number(profileIdx)]?.segment || "") + "",
    };
  }, [hazardNo, profileIdx, likelihoodPreset, likelihoodCustom, c1, c2, c3]);

  function upsertHazard() {
    if (live.sum123 > 100.0001) {
      alert("Class I + II + III must be ≤ 100%. Please adjust your outcomes.");
      return;
    }
    captureMetaToSettings();

    const entry = {
      hazardNo,
      hazard: hz.name,
      profile: live.profileName,
      likelihood: live.L,
      outcomes: {
        classI: Number(c1) || 0,
        classII: Number(c2) || 0,
        classIII: Number(c3) || 0,
        classIV: Number(live.c4.toFixed(1)),
      },
      score: live.score,
      band: live.band,
      category: live.category,
      meta: {
        clientName: clientName.trim(),
        propertyRef: propertyRef.trim(),
        address: address.trim(),
        surveyDate,
        surveyor: surveyor.trim(),
        items: items.trim(),
        justification: justification.trim(),
      },
      updatedAt: new Date().toISOString(),
    };

    setReport((prev) => {
      const idx = prev.findIndex((x) => String(x.hazardNo) === String(hazardNo));
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = entry;
        return copy;
      }
      return [...prev, entry];
    });
  }

  function editHazard(hNo) {
    const entry = report.find((x) => String(x.hazardNo) === String(hNo));
    if (!entry) return;
    setHazardNo(String(entry.hazardNo));
    const hzNow = hazardStats[String(entry.hazardNo)];
    const idx = hzNow?.profiles?.findIndex((p) => p.segment === entry.profile) ?? -1;
    setProfileIdx(idx >= 0 ? idx : defaultProfileIndex(hzNow));
    setClientName(entry.meta?.clientName || "");
    setPropertyRef(entry.meta?.propertyRef || "");
    setAddress(entry.meta?.address || "");
    setSurveyDate(entry.meta?.surveyDate || surveyDate);
    setSurveyor(entry.meta?.surveyor || "");
    setItems(entry.meta?.items || "");
    setJustification(entry.meta?.justification || "");
    setLikelihoodPreset(String(entry.likelihood));
    setLikelihoodCustom("");
    setC1(entry.outcomes?.classI ?? 0);
    setC2(entry.outcomes?.classII ?? 0);
    setC3(entry.outcomes?.classIII ?? 0);
  }

  function removeHazard(hNo) {
    setReport((prev) => prev.filter((x) => String(x.hazardNo) !== String(hNo)));
  }

  function clearReport() {
    if (!confirm("Clear the whole report?")) return;
    setReport([]);
  }

  function generateAllDefaults() {
    captureMetaToSettings();
    const baseMeta = {
      clientName: (clientName || "").trim(),
      propertyRef: (propertyRef || "").trim(),
      address: (address || "").trim(),
      surveyDate,
      surveyor: (surveyor || "").trim(),
    };

    const newReport = hazardKeys.map((hNo) => {
      const hz = hazardStats[hNo];
      const pIdx = defaultProfileIndex(hz);
      const p = hz.profiles[pIdx];
      const { total, c4 } = computeScore(Number(p.likelihood), Number(p.classI), Number(p.classII), Number(p.classIII));
      const score = Math.round(total);
      const band = bandFromScore(score);
      const cat = categoryFromBand(band);
      return {
        hazardNo: hNo,
        hazard: hz.name,
        profile: p.segment,
        likelihood: Number(p.likelihood),
        outcomes: { classI: Number(p.classI), classII: Number(p.classII), classIII: Number(p.classIII), classIV: Number(c4.toFixed(1)) },
        score,
        band,
        category: cat,
        meta: { ...baseMeta, items: "", justification: "" },
        updatedAt: new Date().toISOString(),
      };
    });

    setReport(newReport);
    alert("Generated all hazards using the default profile (prefers “All dwellings”). Now edit each hazard with real inspection info.");
  }

  function applyMetaToAll() {
    captureMetaToSettings();
    setReport((prev) =>
      prev.map((r) => ({
        ...r,
        meta: {
          ...(r.meta || {}),
          clientName: (clientName || "").trim(),
          propertyRef: (propertyRef || "").trim(),
          address: (address || "").trim(),
          surveyDate,
          surveyor: (surveyor || "").trim(),
        },
        updatedAt: new Date().toISOString(),
      }))
    );
    alert("Applied Client/Ref/Address/Survey date/Surveyor to all hazards in the report.");
  }

  const summary = useMemo(() => {
    const bands = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0 };
    let cat1 = 0;
    let cat2 = 0;
    let maxScore = -1;
    let maxHazard = null;
    report.forEach((r) => {
      if (bands[r.band] !== undefined) bands[r.band]++;
      if (r.category === "Category 1") cat1++;
      else cat2++;
      if (r.score > maxScore) {
        maxScore = r.score;
        maxHazard = r;
      }
    });
    return { bands, cat1, cat2, maxScore, maxHazard, total: report.length };
  }, [report]);

  function exportJson() {
    const payload = { settings, report };
    downloadBlob("hhsrs-report-1-29.json", new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  }

  async function importJson(file) {
    const txt = await file.text();
    const obj = JSON.parse(txt);
    if (obj.settings) setSettings(obj.settings);
    if (obj.report) setReport(obj.report);
    alert("Imported report JSON successfully.");
  }

  function exportCsv() {
    const rows = report.slice().sort((a, b) => Number(a.hazardNo) - Number(b.hazardNo));
    const header = [
      "hazard_no",
      "hazard",
      "profile",
      "likelihood",
      "classI",
      "classII",
      "classIII",
      "classIV",
      "score",
      "band",
      "category",
      "client",
      "property_ref",
      "address",
      "survey_date",
      "surveyor",
      "items",
      "justification",
    ];
    const lines = [header.join(",")];
    const esc = (v) => {
      const s = (v ?? "").toString();
      if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    rows.forEach((r) => {
      lines.push(
        [
          r.hazardNo,
          r.hazard,
          r.profile,
          r.likelihood,
          r.outcomes.classI,
          r.outcomes.classII,
          r.outcomes.classIII,
          r.outcomes.classIV,
          r.score,
          r.band,
          r.category,
          r.meta?.clientName || "",
          r.meta?.propertyRef || "",
          r.meta?.address || "",
          r.meta?.surveyDate || "",
          r.meta?.surveyor || "",
          r.meta?.items || "",
          r.meta?.justification || "",
        ].map(esc).join(",")
      );
    });
    downloadBlob("hhsrs-report-1-29.csv", new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  }

  function overallRisk() {
    const cat1List = report
      .filter((r) => r.category === "Category 1")
      .sort((a, b) => Number(a.hazardNo) - Number(b.hazardNo))
      .map((r) => `${r.hazardNo}. ${r.hazard} (Band ${r.band}, Score ${r.score})`);
    if (cat1List.length) {
      return {
        title: "HIGH – Category 1 hazard(s) present (Bands A–C)",
        detail: "Category 1 hazards: " + cat1List.join(" • "),
        level: "red",
      };
    }
    return {
      title: "MODERATE / LOW – No Category 1 hazards recorded",
      detail: "All recorded hazards are Category 2 (Bands D–J).",
      level: "green",
    };
  }

  function generatePdf() {
    if (!report.length) {
      alert("Add hazards to the report first (or click Generate all hazards).");
      return;
    }
    captureMetaToSettings();

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const pageW = 595;
    const pageH = 842;
    const contentW = pageW - margin * 2;

    const ensure = (y, need = 60) => {
      if (y + need > pageH - margin) {
        doc.addPage();
        return margin;
      }
      return y;
    };

    const headerBanner = (title, subtitle) => {
      doc.setFillColor(245, 247, 255);
      doc.rect(0, 0, pageW, 110, "F");
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(title, margin, 38);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.text(subtitle, margin, 60);

      if (settings.logoDataUrl) {
        try {
          doc.addImage(settings.logoDataUrl, "PNG", pageW - margin - 120, 22, 120, 60);
        } catch {
          // ignore image failure
        }
      }
    };

    const kv = (y, k, v) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(k, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(v ?? ""), margin + 210, y);
      return y + 16;
    };

    const riskBox = (y, r) => {
      const colors =
        r.level === "red"
          ? { fill: [254, 243, 242], stroke: [254, 205, 202], text: [180, 35, 24] }
          : r.level === "amber"
          ? { fill: [255, 250, 235], stroke: [254, 223, 137], text: [181, 71, 8] }
          : { fill: [236, 253, 243], stroke: [171, 239, 198], text: [6, 118, 71] };

      doc.setDrawColor(...colors.stroke);
      doc.setFillColor(...colors.fill);
      doc.roundedRect(margin, y, contentW, 44, 10, 10, "FD");
      doc.setTextColor(...colors.text);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(r.title, margin + 12, y + 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const detail = doc.splitTextToSize(r.detail, contentW - 24);
      doc.text(detail, margin + 12, y + 34);
      doc.setTextColor(15, 23, 42);
      return y + 62;
    };

    const rows = report.slice().sort((a, b) => Number(a.hazardNo) - Number(b.hazardNo));
    const s = summary;
    const risk = overallRisk();

    // Cover + summary on first page (merged)
    headerBanner("HHSRS Inspection Report", "Hazards 1–29 • Score • Band • Category • PDF Report");
    let y = 130;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Property & Client details", margin, y);
    y += 10;

    y = kv(y, "Client / Organisation:", clientName);
    y = kv(y, "Property reference:", propertyRef);
    y = kv(y, "Address:", address);
    y = kv(y, "Survey date:", surveyDate);
    y = kv(y, "Surveyor:", surveyor);
    y = kv(y, "Generated:", new Date().toLocaleString());

    y += 10;
    y = riskBox(y, risk);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Summary", margin, y);
    y += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Total hazards: ${s.total} • Category 1: ${s.cat1} • Category 2: ${s.cat2} • Highest score: ${fmt(s.maxScore)}`, margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const bandLine = Object.keys(s.bands).map((k) => `${k}:${s.bands[k]}`).join(" · ");
    doc.text(`Bands: ${bandLine}`, margin, y);

    // Results table page
    doc.addPage();
    headerBanner("Results by hazard", [clientName && `Client: ${clientName}`, propertyRef && `Ref: ${propertyRef}`, address && `Address: ${address}`, surveyDate && `Survey date: ${surveyDate}`, surveyor && `Surveyor: ${surveyor}`].filter(Boolean).join(" · "));
    y = 130;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Hazard", margin, y);
    doc.text("Profile", margin + 220, y);
    doc.text("Likelihood", margin + 350, y);
    doc.text("Score", margin + 430, y);
    doc.text("Band", margin + 470, y);
    doc.text("Category", margin + 505, y);
    y += 10;
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y, margin + contentW, y);
    y += 14;

    doc.setFont("helvetica", "normal");
    rows.forEach((r) => {
      y = ensure(y, 18);
      const name = doc.splitTextToSize(`${r.hazardNo}. ${r.hazard}`, 210);
      doc.text(name, margin, y);
      const prof = doc.splitTextToSize(String(r.profile || ""), 120);
      doc.text(prof, margin + 220, y);
      doc.text(`1 in ${fmt(r.likelihood)}`, margin + 350, y);
      doc.text(String(fmt(r.score)), margin + 430, y);
      doc.text(String(r.band), margin + 470, y);
      doc.text(String(r.category), margin + 505, y);
      y += Math.max(16, name.length * 10);
    });

    // Detail pages
    rows.forEach((r, idx) => {
      doc.addPage();
      headerBanner(`Hazard ${r.hazardNo}: ${r.hazard}`, `Section ${idx + 1} / ${rows.length}`);
      y = 130;

      const field = (k, v) => {
        y = ensure(y, 20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(k, margin, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        const vv = doc.splitTextToSize(String(v ?? "—"), contentW - 180);
        doc.text(vv, margin + 170, y);
        y += Math.max(16, vv.length * 12);
      };

      field("Profile", r.profile || "—");
      field("Likelihood", `1 in ${fmt(r.likelihood)}`);
      field("Outcome spread", `I=${r.outcomes.classI}, II=${r.outcomes.classII}, III=${r.outcomes.classIII}, IV=${r.outcomes.classIV}`);
      field("Score / Band / Category", `${fmt(r.score)} · ${r.band} · ${r.category}`);
      field("Items / deficiencies", r.meta?.items || "—");
      field("Justification", r.meta?.justification || "—");

      y += 8;
      y = ensure(y, 60);
      doc.setFont("helvetica", "bold");
      doc.text("Assessment standard (HHSRS)", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(doc.splitTextToSize(HHSRS_STANDARD_TEXT, contentW), margin, y);
      y += 40;

      y = ensure(y, 60);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Key legal / statutory guidance references (by hazard)", margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const refs = (getLegalRefs(r.hazardNo) || []).join(" • ");
      doc.text(doc.splitTextToSize(refs || "—", contentW), margin, y);
    });

    // Sign-off page
    doc.addPage();
    headerBanner("Sign-off", "Signature & acknowledgement");
    y = 130;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Surveyor", margin, y);
    y += 16;
    y = kv(y, "Name:", surveyor || "—");
    y = kv(y, "Date:", surveyDate || "—");
    y += 8;
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentW, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Signature:", margin + 10, y + 16);

    y += 80;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Client / Responsible person", margin, y);
    y += 16;
    y = kv(y, "Name:", "—");
    y = kv(y, "Date:", "—");
    y += 8;
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentW, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Signature:", margin + 10, y + 16);

    doc.save(`HHSRS_Report_${(settings.propertyRef || "").trim() || "property"}.pdf`);
  }

  const importInputRef = useRef(null);

const datasetInputRef = useRef(null);

async function importDataset(file) {
  const text = await file.text();
  let obj = null;

  // Try JSON file first
  try {
    obj = JSON.parse(text);
  } catch {
    obj = null;
  }

  // Try extracting from HTML/text: const HAZARD_STATS = JSON.parse('...');
  if (!obj) {
    const m = text.match(/const\s+HAZARD_STATS\s*=\s*JSON\.parse\('\s*([\s\S]*?)\s*'\)\s*;?/);
    if (m && m[1]) {
      obj = JSON.parse(m[1]);
    }
  }

  if (!obj || typeof obj !== "object") {
    throw new Error("Could not find a valid HAZARD_STATS dataset in this file.");
  }

  setHazardStats(obj);
  try {
    localStorage.setItem("hhsrs_hazard_stats_v1_1", JSON.stringify(obj));
  } catch {}

  alert("Hazard dataset imported successfully. Profiles/defaults are now updated.");
}

function resetDataset() {
  setHazardStats(DEFAULT_HAZARD_STATS);
  try { localStorage.removeItem("hhsrs_hazard_stats_v1_1"); } catch {}
  alert("Hazard dataset reset to the built-in default.");
}


  const sortedReport = useMemo(() => report.slice().sort((a, b) => Number(a.hazardNo) - Number(b.hazardNo)), [report]);

  return (
    <div className="card">
      <div className="topbar">
        <div>
          <div className="kicker">Inspection tool</div>
          <div className="h1">HHSRS Calculator</div>
          <div className="small">Hazards 1–29 • Likelihood “1 in N” + Classes I–IV • PDF / CSV / JSON</div>
        </div>
        <div className="actions">
          {headerRight}
          <span className={`badge ${live.category === "Category 1" ? "red" : "amber"}`}>
            Live: {live.band} • {live.category}
          </span>
          <button className="btn" onClick={generatePdf}>
            Generate HHSRS PDF
          </button>
        </div>
      </div>

      <div className="hr" />

      <div className="row">
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Hazard</label>
          <select value={hazardNo} onChange={(e) => setHazardNo(e.target.value)}>
            {hazardKeys.map((k) => (
              <option key={k} value={k}>
                {k}. {hazardStats[k].name}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Property age band</label>
          <select value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
            {AGE_BANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Property type</label>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ gridColumn: "span 12" }}>
          <label>Profile defaults (Annex D)</label>
          <select value={String(profileIdx)} onChange={(e) => setProfileIdx(Number(e.target.value))}>
            {filteredProfiles.map((p) => (
              <option key={p._idx} value={p._idx}>
                {p.segment}
              </option>
            ))}
          </select>
          <div className="small">
            Select age/type above to filter profiles. If no exact match exists for this hazard, the app automatically
            falls back to the closest available profile (or “All Dwellings”).
          </div>
        </div>
      </div>

      <div className="hr" />

      <div className="row">
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Client / Organisation</label>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Property reference</label>
          <input value={propertyRef} onChange={(e) => setPropertyRef(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Survey date</label>
          <input type="date" value={surveyDate} onChange={(e) => setSurveyDate(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 8" }}>
          <label>Address</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Surveyor</label>
          <input value={surveyor} onChange={(e) => setSurveyor(e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ gridColumn: "span 6" }}>
          <label>Items / deficiencies (for this hazard)</label>
          <textarea value={items} onChange={(e) => setItems(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 6" }}>
          <label>Justification (for this hazard)</label>
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} />
        </div>
      </div>

      <div className="hr" />

      <div className="row">
        <div className="field" style={{ gridColumn: "span 4" }}>
          <label>Likelihood preset (“1 in N”)</label>
          <select value={likelihoodPreset} onChange={(e) => setLikelihoodPreset(e.target.value)}>
            {LIKELIHOOD_POINTS.map((n) => (
              <option key={n} value={String(n)}>
                1 in {n.toLocaleString()}
              </option>
            ))}
          </select>
          <div className="small">Or type a custom N below.</div>
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Custom N</label>
          <input type="number" min="1" step="1" value={likelihoodCustom} onChange={(e) => setLikelihoodCustom(e.target.value)} placeholder="e.g., 320" />
        </div>
        <div className="field" style={{ gridColumn: "span 6" }}>
          <label>Probability (approx.)</label>
          <div className="pill">≈ {live.probPct.toFixed(3)}% (1/{fmt(live.L)})</div>
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ gridColumn: "span 3" }}>
          <label>Class I (%)</label>
          <input type="number" min="0" max="100" step="0.1" value={c1} onChange={(e) => setC1(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 3" }}>
          <label>Class II (%)</label>
          <input type="number" min="0" max="100" step="0.1" value={c2} onChange={(e) => setC2(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 3" }}>
          <label>Class III (%)</label>
          <input type="number" min="0" max="100" step="0.1" value={c3} onChange={(e) => setC3(e.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "span 3" }}>
          <label>Class IV (%) (auto)</label>
          <input value={fmt(live.c4, 1)} readOnly />
        </div>
      </div>

      <div className="help" style={{ marginTop: 10 }}>
        {live.sum123 > 100.0001 ? (
          <span className="bad">Class I+II+III = {fmt(live.sum123, 1)}% (must be ≤ 100%).</span>
        ) : (
          <span>Class I+II+III = {fmt(live.sum123, 1)}% → Class IV auto = {fmt(live.c4, 1)}%</span>
        )}
      </div>

      <div style={{ height: 10 }} />

      <div className="row">
        <div className="field" style={{ gridColumn: "span 12" }}>
          <label>Live breakdown</label>
          <table className="tbl">
            <thead>
              <tr>
                <th>Component</th>
                <th>Weight</th>
                <th>Outcome %</th>
                <th>Contribution</th>
              </tr>
            </thead>
            <tbody>
              {live.parts.map((p) => (
                <tr key={p.cls}>
                  <td><b>{p.cls}</b></td>
                  <td>{fmt(p.w)}</td>
                  <td>{fmt(p.pct, 1)}%</td>
                  <td>{fmt(p.val, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hr" />

      <label>Standards / legal & statutory guidance (reference)</label>
      <div className="pill" style={{ width: "100%", display: "block", padding: "10px 12px" }}>
        {HHSRS_STANDARD_TEXT}
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        Hazard references:
        <div style={{ marginTop: 6, opacity: 0.9 }}>
          {(getLegalRefs(hazardNo) || []).map((r) => (
            <div key={r}>• {r}</div>
          ))}
        </div>
      </div>

      <div className="actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn" onClick={upsertHazard}>
          Add / Update this hazard in report
        </button>
        <button className="btn secondary" onClick={generateAllDefaults}>
          Generate all 29 hazards (defaults)
        </button>
        <button className="btn secondary" onClick={applyMetaToAll}>
          Apply report meta to all hazards
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setItems("");
            setJustification("");
            setProfileIdx(defaultProfileIndex(hz));
          }}
        >
          Reset hazard inputs
        </button>
      </div>

      <div className="mini" style={{ marginTop: 10 }}>
        Bands: A≥5000, B 2000–4999, C 1000–1999, D 500–999, E 200–499, F 100–199, G 50–99, H 20–49, I 10–19, J≤9.
      </div>

      <div className="hr" />

      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div className="pill">
          <b>Report list</b> <span style={{ marginLeft: 8 }}>{summary.total}</span>
        </div>
        <div className="actions" style={{ margin: 0, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={generatePdf}>
            PDF
          </button>
          <button className="btn ghost" onClick={exportJson}>
            Export JSON
          </button>
          <button className="btn ghost" onClick={() => importInputRef.current?.click()}>
            Import JSON
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importJson(f);
              } catch {
                alert("Import failed: invalid JSON.");
              } finally {
                e.target.value = "";
              }
            }}
          />
          
<input
  ref={datasetInputRef}
  type="file"
  accept=".json,.html,text/html,application/json,text/plain"
  style={{ display: "none" }}
  onChange={async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      await importDataset(f);
    } catch (err) {
      alert(String(err?.message || err || "Dataset import failed"));
    } finally {
      e.target.value = "";
    }
  }}
/>
<button className="btn ghost" onClick={exportCsv}>
            Export CSV
          </button>
          <button className="btn ghost" onClick={() => datasetInputRef.current?.click()}>
            Import dataset
          </button>
          <button className="btn ghost" onClick={resetDataset}>
            Reset dataset
          </button>
          <button className="btn danger" onClick={clearReport}>
            Clear report
          </button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <div className="field" style={{ gridColumn: "span 12" }}>
          <label>Band & Category summary</label>
          {!summary.total ? (
            <div className="pill">No hazards yet.</div>
          ) : (
            <>
              <div className="pill">
                {summary.total} hazards • Cat 1: {summary.cat1} • Cat 2: {summary.cat2} • Highest: {fmt(summary.maxScore)} (Hazard{" "}
                {summary.maxHazard?.hazardNo})
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                Bands: {Object.keys(summary.bands).map((k) => `${k}:${summary.bands[k]}`).join(" · ")}
              </div>
            </>
          )}
        </div>
      </div>

      <table className="tbl" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Hazard</th>
            <th>Score</th>
            <th>Band</th>
            <th>Category</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedReport.map((r) => (
            <tr key={r.hazardNo}>
              <td>
                <b>
                  {r.hazardNo}. {r.hazard}
                </b>
                <div className="mini">{r.profile || ""}</div>
              </td>
              <td>{fmt(r.score)}</td>
              <td>
                <b>{r.band}</b>
              </td>
              <td>
                <span className={`tag ${r.category === "Category 1" ? "cat1" : "cat2"}`}>{r.category}</span>
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="btn ghost" style={{ padding: "6px 10px" }} onClick={() => editHazard(r.hazardNo)}>
                  Edit
                </button>{" "}
                <button className="btn ghost" style={{ padding: "6px 10px" }} onClick={() => removeHazard(r.hazardNo)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="hint" style={{ marginTop: 8 }}>
        Tip: Use “Generate all 29 hazards (defaults)” then edit each hazard with the real inspection info. If your profile defaults are missing, click “Import dataset” and upload your original HHSRS HTML or a JSON dataset.
      </div>
    </div>
  );
}
