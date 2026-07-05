#!/usr/bin/env node
"use strict";

/*
 * San Felipe Plaza Master Activity Stack generator.
 *
 * Reads data/deal-stack.json, builds the workbook via the shared core, and
 * writes it to exports/ with the team's filename pattern:
 *   SFP - Master + Activity Stack_M.D.YY.xlsx
 *
 * Run: npm run generate:sfp
 *
 * The Jones on Main control book will be a sibling file that imports the same
 * core and swaps this config block.
 */

const fs = require("fs");
const path = require("path");
const { buildActivityStackWorkbook, outputFilename } = require("./lib/activity-stack-core");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "deal-stack.json");
const OUT_DIR = path.join(ROOT, "exports");

// -------------------------------------------------------------------
// Building config. Calibrate against the reference workbook.
// Add a `floors` inventory (see shape below) to render every floor in the
// Stacking Diagram and Vacancy Conditions tabs, not just tracked suites.
//
//   floors: [
//     { floor: 18, suites: [
//         { suite: "1800", tenant: "Acme LLP", rsf: 12500,
//           status: "leased", expiration: "12/31/28",
//           condition: "As-is", available: "", notes: "" }
//     ]},
//   ]
// -------------------------------------------------------------------
const CONFIG = {
  code: "SFP",
  buildingName: "San Felipe Plaza",
  owner: "Sovereign",
  commentOrder: "asc", // newest last, like a hand-kept comment log
  asOf: new Date(),
  floors: [], // inventory not loaded yet
};

function main() {
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  const data = JSON.parse(raw);
  const deals = Array.isArray(data.deals) ? data.deals : [];

  const { workbook, dealCount } = buildActivityStackWorkbook(CONFIG, deals);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const filename = outputFilename(CONFIG, CONFIG.asOf);
  const outPath = path.join(OUT_DIR, filename);

  return workbook.xlsx.writeFile(outPath).then(() => {
    console.log(`Wrote ${path.relative(ROOT, outPath)} (${dealCount} deal${dealCount === 1 ? "" : "s"} for ${CONFIG.buildingName})`);
    if (!CONFIG.floors.length) {
      console.log(
        "Note: no floor inventory loaded, stacking and vacancy tabs show tracked suites only."
      );
    }
    console.log(
      "Note: built without the reference workbook. Calibrate columns and phrasing against SFP-Master-Activity-Stack-reference.xlsx when available."
    );
  });
}

main().catch((e) => {
  console.error("generate:sfp failed:", e.message);
  process.exit(1);
});
