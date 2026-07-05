"use strict";

/*
 * Reusable core for landlord "Master Activity Stack" workbooks.
 *
 * One building = one config object + the deals for that building. The SFP
 * generator and the coming Jones on Main control book both call
 * buildActivityStackWorkbook() with their own config, so the tab structure,
 * formatting, and phrasing live here once.
 *
 * NOTE ON FIDELITY: this was written without the reference workbook
 * (/reference/SFP-Master-Activity-Stack-reference.xlsx was not present in the
 * environment). Tab structure, columns, and phrasing follow the standard
 * landlord activity stack format described in the brief. Exact column widths,
 * fills, and header wording should be calibrated against the real file. All
 * of that lives in the STYLE and column definitions below so calibration is a
 * data edit, not a rewrite.
 */

const ExcelJS = require("exceljs");

/* ------------------------------------------------------------------ *
 * Stage grouping for the Activity Report
 * ------------------------------------------------------------------ */

// deal-stack stages, in the order a leasing report walks them.
const STAGE_ORDER = [
  "proposal_out",
  "negotiating",
  "loi_agreed",
  "legal",
  "lease_out",
  "touring",
  "inquiry",
  "executed",
  "dead",
];

// Group headings as a team would write them on the report.
const STAGE_HEADING = {
  proposal_out: "PROPOSALS OUTSTANDING",
  negotiating: "NEGOTIATING",
  loi_agreed: "LOI AGREED",
  legal: "LEGAL / LEASE DOCUMENTATION",
  lease_out: "LEASE OUT FOR SIGNATURE",
  touring: "TOURING",
  inquiry: "PROSPECTS / INQUIRIES",
  executed: "EXECUTED",
  dead: "DEAD / LOST",
};

const STATUS_FILL = {
  leased: "FFC6E0B4", // green
  proposal: "FFBDD7EE", // blue
  legal: "FFD9C7EC", // purple
  touring: "FFFCE4A6", // gold
  vacant: "FFF2F2F2", // light grey
  dead: "FFE7E6E6", // grey
};

function statusForStage(stage) {
  if (stage === "executed") return "leased";
  if (stage === "legal" || stage === "lease_out") return "legal";
  if (stage === "loi_agreed" || stage === "negotiating" || stage === "proposal_out")
    return "proposal";
  if (stage === "touring" || stage === "inquiry") return "touring";
  return "vacant"; // dead
}

/* ------------------------------------------------------------------ *
 * Shared style tokens (calibrate these against the reference)
 * ------------------------------------------------------------------ */

const STYLE = {
  fontName: "Calibri",
  titleSize: 14,
  headerFill: "FF001C29", // Partners midnight
  headerFont: "FFFFFFFF",
  groupFill: "FFCFAF6C", // Partners gold
  groupFont: "FF001C29",
  borderColor: "FFBFBFBF",
};

function thinBorder() {
  const s = { style: "thin", color: { argb: STYLE.borderColor } };
  return { top: s, left: s, bottom: s, right: s };
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STYLE.headerFill } };
    cell.font = { name: STYLE.fontName, bold: true, color: { argb: STYLE.headerFont }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
  row.height = 26;
}

function styleGroupRow(cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STYLE.groupFill } };
  cell.font = { name: STYLE.fontName, bold: true, color: { argb: STYLE.groupFont }, size: 10 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleBody(row) {
  row.eachCell((cell) => {
    if (!cell.font) cell.font = { name: STYLE.fontName, size: 10 };
    cell.border = thinBorder();
    if (!cell.alignment) cell.alignment = { vertical: "top", wrapText: true };
  });
}

/* ------------------------------------------------------------------ *
 * Date helpers
 * ------------------------------------------------------------------ */

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "2026-07-01" -> "07/01/26" for comment lines.
function commentDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

// Date -> "7.5.26" (no leading zeros) for the filename.
function fileDate(date) {
  return `${date.getMonth() + 1}.${date.getDate()}.${String(date.getFullYear()).slice(2)}`;
}

// "M/D/YY" long-ish for headers, e.g. "July 5, 2026".
function longDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/* ------------------------------------------------------------------ *
 * Comment rendering (terse broker register)
 * ------------------------------------------------------------------ */

// Turn a deal's log into the dated Comments cell:
//   07/01/26 - LLP1 sent to Savills.
//   07/03/26 - Counter received.
// Order controlled by config.commentOrder ("asc" default, newest last).
function renderComments(log, order) {
  if (!Array.isArray(log) || log.length === 0) return "";
  const rows = [...log].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (order === "desc") rows.reverse();
  return rows
    .map((e) => `${commentDate(e.date)} - ${terse(e.event)}`)
    .join("\n");
}

// Light touch: make sure the line ends like a register entry. The sweep
// engine already writes terse entries, so this mostly passes text through.
function terse(event) {
  let s = String(event || "").trim();
  if (s && !/[.!?]$/.test(s)) s += ".";
  return s;
}

function latestComment(log) {
  if (!Array.isArray(log) || log.length === 0) return "";
  const rows = [...log].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `${commentDate(rows[0].date)} - ${terse(rows[0].event)}`;
}

/* ------------------------------------------------------------------ *
 * Column definitions per sheet (calibrate widths here)
 * ------------------------------------------------------------------ */

const COLS = {
  activityReport: [
    { header: "Floor", key: "floor", width: 8 },
    { header: "Suite", key: "suite", width: 12 },
    { header: "Prospect / Tenant", key: "tenant", width: 26 },
    { header: "Type", key: "type", width: 14 },
    { header: "Tenant Rep", key: "broker", width: 22 },
    { header: "RSF", key: "rsf", width: 10 },
    { header: "Term (mo)", key: "term", width: 10 },
    { header: "Rate (NNN)", key: "rate", width: 11 },
    { header: "Comments", key: "comments", width: 60 },
  ],
  stacking: [
    { header: "Floor", key: "floor", width: 8 },
    { header: "Suite", key: "suite", width: 12 },
    { header: "Tenant", key: "tenant", width: 28 },
    { header: "RSF", key: "rsf", width: 10 },
    { header: "Lease Expiration", key: "exp", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Encumbrances / Notes", key: "notes", width: 40 },
  ],
  dealList: [
    { header: "Suite", key: "suite", width: 12 },
    { header: "Tenant", key: "tenant", width: 26 },
    { header: "Tenant Rep", key: "broker", width: 22 },
    { header: "Stage", key: "stage", width: 16 },
    { header: "Ball", key: "ball", width: 10 },
    { header: "RSF", key: "rsf", width: 10 },
    { header: "Rate (NNN)", key: "rate", width: 11 },
    { header: "NER", key: "ner", width: 10 },
    { header: "Clock Due", key: "due", width: 12 },
    { header: "Last Activity", key: "last", width: 46 },
  ],
  vacancy: [
    { header: "Floor", key: "floor", width: 8 },
    { header: "Suite", key: "suite", width: 12 },
    { header: "RSF", key: "rsf", width: 10 },
    { header: "Condition", key: "condition", width: 22 },
    { header: "Available", key: "available", width: 14 },
    { header: "Notes", key: "notes", width: 40 },
  ],
};

/* ------------------------------------------------------------------ *
 * Floor parsing / ordering
 * ------------------------------------------------------------------ */

function floorRank(floorSuite) {
  const s = String(floorSuite || "").toLowerCase();
  if (s.includes("ground")) return 0;
  const m = s.match(/(\d+)(?:st|nd|rd|th)?\s*floor/);
  if (m) return parseInt(m[1], 10);
  const any = s.match(/\d+/);
  return any ? parseInt(any[0], 10) : -1;
}

function floorLabel(floorSuite) {
  const r = floorRank(floorSuite);
  if (r === 0) return "Grnd";
  if (r > 0) return String(r);
  return "-";
}

function suiteLabel(floorSuite) {
  const s = String(floorSuite || "");
  const m = s.match(/suite\s*([\w-]+)/i);
  if (m) return m[1];
  if (/full floor/i.test(s)) return "Full";
  return s;
}

/* ------------------------------------------------------------------ *
 * Sheet builders
 * ------------------------------------------------------------------ */

function titleBlock(ws, config, colCount, subtitle) {
  ws.mergeCells(1, 1, 1, colCount);
  const t = ws.getCell(1, 1);
  t.value = `${config.buildingName} - Master Activity Stack`;
  t.font = { name: STYLE.fontName, bold: true, size: STYLE.titleSize, color: { argb: STYLE.headerFill } };
  t.alignment = { horizontal: "left" };

  ws.mergeCells(2, 1, 2, colCount);
  const s = ws.getCell(2, 1);
  s.value = `Owner: ${config.owner}   |   ${subtitle}   |   As of ${longDate(config.asOf)}`;
  s.font = { name: STYLE.fontName, italic: true, size: 9, color: { argb: "FF666666" } };
  ws.getRow(1).height = 20;
}

function applyColumns(ws, defs) {
  ws.columns = defs.map((d) => ({ key: d.key, width: d.width }));
}

function buildActivityReport(wb, config, deals) {
  const ws = wb.addWorksheet("Activity Report", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const defs = COLS.activityReport;
  applyColumns(ws, defs);
  titleBlock(ws, config, defs.length, "Activity Report");

  // Header row at row 4.
  const headerRow = ws.getRow(4);
  defs.forEach((d, i) => (headerRow.getCell(i + 1).value = d.header));
  styleHeaderRow(headerRow);

  let r = 5;
  const present = STAGE_ORDER.filter((st) => deals.some((d) => d.stage === st));
  for (const stage of present) {
    const group = deals
      .filter((d) => d.stage === stage)
      .sort((a, b) => floorRank(b.floor_suite) - floorRank(a.floor_suite));
    if (group.length === 0) continue;

    ws.mergeCells(r, 1, r, defs.length);
    const gc = ws.getCell(r, 1);
    gc.value = `${STAGE_HEADING[stage] || stage}  (${group.length})`;
    styleGroupRow(gc);
    ws.getRow(r).height = 18;
    r += 1;

    for (const d of group) {
      const e = d.economics || {};
      const p = d.people || {};
      const row = ws.getRow(r);
      row.values = {
        floor: floorLabel(d.floor_suite),
        suite: suiteLabel(d.floor_suite),
        tenant: d.tenant,
        type: d.tenant_type,
        broker: p.tenant_broker || "",
        rsf: typeof d.rsf === "number" ? d.rsf : "",
        term: e.term_mo != null ? e.term_mo : "",
        rate: e.rate_nnn != null ? e.rate_nnn : "",
        comments: renderComments(d.log, config.commentOrder),
      };
      row.getCell("rsf").numFmt = "#,##0";
      row.getCell("rate").numFmt = '"$"#,##0.00';
      row.getCell("comments").alignment = { vertical: "top", wrapText: true };
      row.alignment = { vertical: "top", wrapText: true };
      styleBody(row);
      // Rough auto-height from comment line count.
      const lines = String(row.getCell("comments").value || "").split("\n").length;
      row.height = Math.max(16, lines * 13);
      r += 1;
    }
  }

  if (r === 5) {
    ws.getCell(5, 1).value = "No deals for this building.";
  }
  return ws;
}

function buildStacking(wb, config, deals) {
  const ws = wb.addWorksheet("Stacking Diagram", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const defs = COLS.stacking;
  applyColumns(ws, defs);
  titleBlock(ws, config, defs.length, "Stacking Diagram");

  const headerRow = ws.getRow(4);
  defs.forEach((d, i) => (headerRow.getCell(i + 1).value = d.header));
  styleHeaderRow(headerRow);

  // Prefer an explicit inventory; otherwise derive floors from tracked deals.
  const rows = [];
  if (Array.isArray(config.floors) && config.floors.length) {
    for (const fl of config.floors) {
      for (const suite of fl.suites || []) {
        const deal = deals.find((d) => suiteLabel(d.floor_suite) === String(suite.suite));
        rows.push({
          floorNum: fl.floor,
          floor: fl.floor === 0 ? "Grnd" : String(fl.floor),
          suite: suite.suite,
          tenant: deal ? deal.tenant : suite.tenant || "VACANT",
          rsf: suite.rsf != null ? suite.rsf : deal ? deal.rsf : "",
          exp: suite.expiration || "",
          status: deal ? statusForStage(deal.stage) : suite.status || "vacant",
          notes: notesFor(deal, suite),
        });
      }
    }
  } else {
    for (const d of deals) {
      rows.push({
        floorNum: floorRank(d.floor_suite),
        floor: floorLabel(d.floor_suite),
        suite: suiteLabel(d.floor_suite),
        tenant: d.tenant,
        rsf: typeof d.rsf === "number" ? d.rsf : "",
        exp: "",
        status: statusForStage(d.stage),
        notes: Array.isArray(d.encumbrances) ? d.encumbrances.join("; ") : "",
      });
    }
  }

  rows.sort((a, b) => b.floorNum - a.floorNum);

  let r = 5;
  for (const row of rows) {
    const xr = ws.getRow(r);
    xr.values = {
      floor: row.floor,
      suite: row.suite,
      tenant: row.tenant,
      rsf: row.rsf,
      exp: row.exp,
      status: STATUS_TEXT[row.status] || row.status,
      notes: row.notes,
    };
    xr.getCell("rsf").numFmt = "#,##0";
    styleBody(xr);
    const fill = STATUS_FILL[row.status];
    if (fill) {
      ["tenant", "status"].forEach((k) => {
        xr.getCell(k).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      });
    }
    if (row.notes) {
      xr.getCell("notes").font = { name: STYLE.fontName, size: 10, color: { argb: "FFC00000" } };
    }
    r += 1;
  }

  if (!Array.isArray(config.floors) || !config.floors.length) {
    ws.mergeCells(r + 1, 1, r + 1, defs.length);
    const note = ws.getCell(r + 1, 1);
    note.value =
      "Note: building inventory not loaded. Showing tracked suites only. Add config.floors to render every floor.";
    note.font = { name: STYLE.fontName, italic: true, size: 9, color: { argb: "FF999999" } };
  }
  return ws;
}

const STATUS_TEXT = {
  leased: "Leased",
  proposal: "In Proposal",
  legal: "In Legal",
  touring: "Touring",
  vacant: "Vacant",
  dead: "Dead",
};

function notesFor(deal, suite) {
  const parts = [];
  if (deal && Array.isArray(deal.encumbrances)) parts.push(...deal.encumbrances);
  if (suite && suite.notes) parts.push(suite.notes);
  return parts.join("; ");
}

function buildDealList(wb, config, deals) {
  const ws = wb.addWorksheet("Deal Activity List", {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const defs = COLS.dealList;
  applyColumns(ws, defs);
  titleBlock(ws, config, defs.length, "Deal Activity List");

  const headerRow = ws.getRow(4);
  defs.forEach((d, i) => (headerRow.getCell(i + 1).value = d.header));
  styleHeaderRow(headerRow);

  const ordered = [...deals].sort(
    (a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage)
  );

  let r = 5;
  for (const d of ordered) {
    const e = d.economics || {};
    const p = d.people || {};
    const row = ws.getRow(r);
    row.values = {
      suite: suiteLabel(d.floor_suite),
      tenant: d.tenant,
      broker: p.tenant_broker || "",
      stage: (STAGE_HEADING[d.stage] || d.stage).split(" ")[0],
      ball: d.ball,
      rsf: typeof d.rsf === "number" ? d.rsf : "",
      rate: e.rate_nnn != null ? e.rate_nnn : "",
      ner: e.ner != null ? e.ner : "",
      due: d.clock ? commentDate(d.clock.due) : "",
      last: latestComment(d.log),
    };
    row.getCell("rsf").numFmt = "#,##0";
    row.getCell("rate").numFmt = '"$"#,##0.00';
    row.getCell("ner").numFmt = '"$"#,##0.00';
    styleBody(row);
    r += 1;
  }
  return ws;
}

function buildVacancy(wb, config, deals) {
  const ws = wb.addWorksheet("Vacancy Conditions", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const defs = COLS.vacancy;
  applyColumns(ws, defs);
  titleBlock(ws, config, defs.length, "Vacancy Conditions");

  const headerRow = ws.getRow(4);
  defs.forEach((d, i) => (headerRow.getCell(i + 1).value = d.header));
  styleHeaderRow(headerRow);

  const vacancies = [];
  if (Array.isArray(config.floors) && config.floors.length) {
    for (const fl of config.floors) {
      for (const suite of fl.suites || []) {
        if ((suite.status || "vacant") === "vacant") {
          vacancies.push({
            floorNum: fl.floor,
            floor: fl.floor === 0 ? "Grnd" : String(fl.floor),
            suite: suite.suite,
            rsf: suite.rsf != null ? suite.rsf : "",
            condition: suite.condition || "As-is",
            available: suite.available || "Immediate",
            notes: suite.notes || "",
          });
        }
      }
    }
  }
  // Dead deals also free up their suite.
  for (const d of deals.filter((x) => x.stage === "dead")) {
    vacancies.push({
      floorNum: floorRank(d.floor_suite),
      floor: floorLabel(d.floor_suite),
      suite: suiteLabel(d.floor_suite),
      rsf: typeof d.rsf === "number" ? d.rsf : "",
      condition: "As-is (deal fell through)",
      available: "Immediate",
      notes: latestComment(d.log),
    });
  }

  vacancies.sort((a, b) => b.floorNum - a.floorNum);

  let r = 5;
  for (const v of vacancies) {
    const row = ws.getRow(r);
    row.values = v;
    row.getCell("rsf").numFmt = "#,##0";
    styleBody(row);
    r += 1;
  }
  if (vacancies.length === 0) {
    ws.mergeCells(5, 1, 5, defs.length);
    const c = ws.getCell(5, 1);
    c.value = "No known vacancies from tracked data. Add config.floors for a full vacancy list.";
    c.font = { name: STYLE.fontName, italic: true, size: 9, color: { argb: "FF999999" } };
  }
  return ws;
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

function buildActivityStackWorkbook(config, allDeals) {
  const cfg = Object.assign({ commentOrder: "asc", asOf: new Date() }, config);
  const deals = allDeals.filter((d) => d.building === cfg.buildingName);

  const wb = new ExcelJS.Workbook();
  wb.creator = "deal-engine";
  wb.created = cfg.asOf;

  buildActivityReport(wb, cfg, deals);
  buildStacking(wb, cfg, deals);
  buildDealList(wb, cfg, deals);
  buildVacancy(wb, cfg, deals);

  return { workbook: wb, dealCount: deals.length };
}

// "SFP - Master + Activity Stack_7.5.26.xlsx"
function outputFilename(config, date) {
  const d = date || config.asOf || new Date();
  return `${config.code} - Master + Activity Stack_${fileDate(d)}.xlsx`;
}

module.exports = {
  buildActivityStackWorkbook,
  outputFilename,
  fileDate,
  commentDate,
  renderComments,
  statusForStage,
  STAGE_ORDER,
  STAGE_HEADING,
};
