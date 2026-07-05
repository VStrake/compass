#!/usr/bin/env node
"use strict";

/*
 * Audit: cross-check deal-stack.json against the latest generated workbook
 * and list divergences. Answers "is the spreadsheet I last sent out still
 * telling the truth?"
 *
 * For the building the workbook represents, it re-derives the expected values
 * from the JSON and compares them to the workbook's Deal Activity List:
 *   - deals in the JSON that are missing from the workbook (stale export)
 *   - rows in the workbook with no matching deal (deleted or renamed)
 *   - field mismatches (stage, RSF, rate, NER) where the numbers drifted
 *
 * Run: npm run audit
 * Exit 0 if the workbook is in sync, 1 if there are divergences.
 */

const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { STAGE_HEADING } = require("../generators/lib/activity-stack-core");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "deal-stack.json");
const EXPORTS_DIR = path.join(ROOT, "exports");

function latestWorkbook() {
  if (!fs.existsSync(EXPORTS_DIR)) return null;
  const files = fs
    .readdirSync(EXPORTS_DIR)
    .filter((f) => f.endsWith(".xlsx") && !f.startsWith("~$"))
    .map((f) => ({ f, m: fs.statSync(path.join(EXPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? path.join(EXPORTS_DIR, files[0].f) : null;
}

function suiteLabel(floorSuite) {
  const m = String(floorSuite || "").match(/suite\s*([\w-]+)/i);
  if (m) return String(m[1]).toLowerCase();
  if (/full floor/i.test(String(floorSuite))) return "full";
  return String(floorSuite || "").toLowerCase();
}

function stageWord(stage) {
  return (STAGE_HEADING[stage] || stage).split(" ")[0];
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && "result" in v) v = v.result; // formula cell
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

async function main() {
  const wbPath = latestWorkbook();
  if (!wbPath) {
    console.error("No workbook in exports/. Run a generator first (npm run generate:sfp).");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(wbPath);

  // Which building does this workbook cover? Read the title cell.
  const anySheet = wb.worksheets[0];
  const title = String(anySheet.getCell(1, 1).value || "");
  const building = title.replace(/\s*-\s*Master Activity Stack.*/i, "").trim();

  const dealSheet = wb.getWorksheet("Deal Activity List");
  if (!dealSheet) {
    console.error("Workbook has no Deal Activity List sheet, cannot audit.");
    process.exit(1);
  }

  // Column index by header (row 4 is the header row).
  const headerRow = dealSheet.getRow(4);
  const col = {};
  headerRow.eachCell((cell, c) => (col[String(cell.value).trim()] = c));

  // Rows keyed by suite.
  const xlsxRows = new Map();
  for (let r = 5; r <= dealSheet.rowCount; r++) {
    const row = dealSheet.getRow(r);
    const suite = row.getCell(col["Suite"]).value;
    if (suite === null || suite === undefined || suite === "") continue;
    xlsxRows.set(String(suite).toLowerCase(), {
      row: r,
      stage: String(row.getCell(col["Stage"]).value || ""),
      rsf: num(row.getCell(col["RSF"]).value),
      rate: num(row.getCell(col["Rate (NNN)"]).value),
      ner: num(row.getCell(col["NER"]).value),
    });
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const deals = (data.deals || []).filter((d) => d.building === building);

  const divergences = [];
  const seen = new Set();

  for (const d of deals) {
    const key = suiteLabel(d.floor_suite);
    seen.add(key);
    const x = xlsxRows.get(key);
    if (!x) {
      divergences.push(`MISSING in workbook: ${d.building} Suite ${key} (${d.id}). Regenerate.`);
      continue;
    }
    const e = d.economics || {};
    if (x.stage && stageWord(d.stage) !== x.stage) {
      divergences.push(`STAGE drift Suite ${key}: json "${stageWord(d.stage)}" vs xlsx "${x.stage}".`);
    }
    if (num(d.rsf) !== x.rsf) {
      divergences.push(`RSF drift Suite ${key}: json ${num(d.rsf)} vs xlsx ${x.rsf}.`);
    }
    if (num(e.rate_nnn) !== x.rate) {
      divergences.push(`RATE drift Suite ${key}: json ${num(e.rate_nnn)} vs xlsx ${x.rate}.`);
    }
    if (num(e.ner) !== x.ner) {
      divergences.push(`NER drift Suite ${key}: json ${num(e.ner)} vs xlsx ${x.ner}.`);
    }
  }

  for (const key of xlsxRows.keys()) {
    if (!seen.has(key)) {
      divergences.push(`EXTRA in workbook: Suite ${key} has no matching deal in the stack.`);
    }
  }

  console.log(`Audit: ${building}`);
  console.log(`Workbook: ${path.relative(ROOT, wbPath)}`);
  console.log(`Compared ${deals.length} deal(s) against ${xlsxRows.size} workbook row(s).`);
  console.log("");

  if (divergences.length === 0) {
    console.log("In sync. No divergences.");
    process.exit(0);
  }
  console.log(`Divergences (${divergences.length}):`);
  divergences.forEach((d) => console.log("  - " + d));
  console.log("");
  console.log("Regenerate the workbook to resync (npm run generate:sfp).");
  process.exit(1);
}

main().catch((e) => {
  console.error("audit failed:", e.message);
  process.exit(1);
});
