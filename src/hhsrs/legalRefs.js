export const HHSRS_STANDARD_TEXT =
  "HHSRS method: likelihood expressed as “1 in N” + spread of harm outcomes (Classes I–IV). " +
  "Score formula: (10000/L)*CI + (1000/L)*CII + (300/L)*CIII + (10/L)*CIV. " +
  "Framework: Housing Act 2004 Part 1 and HHSRS operating guidance.";

export const HAZARD_LEGAL_REFS = {
  "1": ["Approved Document F (Ventilation)", "Approved Document C (Moisture resistance)"],
  "2": ["Approved Document L (Energy efficiency)", "Approved Document F (Ventilation)"],
  "3": ["Approved Document O (Overheating)", "Approved Document F (Ventilation)"],
  "4": ["Control of Asbestos Regulations 2012"],
  "5": ["COSHH Regulations 2002 (as applicable)"],
  "6": ["Gas Safety (Installation and Use) Regulations 1998", "Approved Document J (Combustion)", "Smoke/CO Alarm Regulations (England)"],
  "7": ["HHSRS Operating Guidance (Lead)"],
  "8": ["Public health / radon guidance (area dependent)"],
  "9": ["Gas Safety (Installation and Use) Regulations 1998"],
  "10": ["COSHH Regulations 2002 (as applicable)", "Approved Document F (Ventilation)"],
  "11": ["Housing Act 1985 (Overcrowding)"],
  "12": ["Approved Document Q (Security)"],
  "13": ["Building Regulations (general safety expectations)"],
  "14": ["Environmental Protection Act 1990 (statutory nuisance - where applicable)"],
  "15": ["Approved Document G (Sanitation & hot water safety)", "Water Supply (Water Fittings) Regulations 1999"],
  "16": ["Food safety framework (general)", "Approved Document G (facilities)"],
  "17": ["Approved Document G (Sanitary conveniences & washing facilities)"],
  "18": ["Water Supply (Water Fittings) Regulations 1999", "Approved Document G (hot water safety)"],
  "19": ["Approved Document G (bathrooms)", "Approved Document K (slips/falls measures)"],
  "20": ["Approved Document K (Protection from falling/collision)"],
  "21": ["Approved Document K (Stairs/guarding)"],
  "22": ["Approved Document K (Guarding/falls between levels)"],
  "23": ["Electrical Safety Standards (PRS England) Regulations 2020", "Approved Document P (Electrical safety)"],
  "24": ["Approved Document B (Fire safety)", "Smoke/CO Alarm Regulations (England)", "Fire Safety Order 2005 (common parts / non-domestic areas)"],
  "25": ["Approved Document G (hot water safety)", "Approved Document K (burn/impact risk measures)"],
  "26": ["Approved Document K (collision/impact)", "Approved Document M (access where relevant)"],
  "27": ["Gas Safety (Installation and Use) Regulations 1998", "Approved Document J (Combustion & fuel storage)"],
  "28": ["Approved Document M (Access & use)", "Approved Document K (layout-related impacts)"],
  "29": ["Approved Document A (Structure)", "Building Regulations context"],
};

export function getLegalRefs(hazardNo) {
  const base = ["Housing Act 2004 Part 1 (HHSRS)", "HHSRS Operating Guidance (reference)"];
  const extras = HAZARD_LEGAL_REFS[String(hazardNo)] || [];
  const seen = new Set();
  return [...base, ...extras].filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

export const LIKELIHOOD_POINTS = [5600, 3200, 1800, 1000, 560, 320, 180, 100, 56, 32, 18, 10, 6, 3, 2, 1];
