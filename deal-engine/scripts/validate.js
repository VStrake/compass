#!/usr/bin/env node
"use strict";

/*
 * deal-engine validation
 *
 * Reads data/deal-stack.json (the source of truth) and checks:
 *   1. Schema integrity      required fields, correct types, valid enum values
 *   2. Stale ownership        deals where ball = "us" for more than 3 days
 *   3. Expired clocks         a clock whose due date is in the past
 *   4. Stage / log drift      the stage does not line up with what the log records
 *
 * Errors (schema problems) exit non-zero so this can gate a commit or a cron.
 * Warnings (stale ball, expired clock, drift) report but do not fail the run.
 */

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "deal-stack.json");

const STAGES = [
  "inquiry",
  "touring",
  "proposal_out",
  "negotiating",
  "loi_agreed",
  "legal",
  "lease_out",
  "executed",
  "dead"
];
const STAGE_RANK = Object.fromEntries(STAGES.map((s, i) => [s, i]));
const BALLS = ["us", "tenant", "attorney", "owner", "client"];

const STALE_BALL_DAYS = 3;

const errors = [];
const warnings = [];

function err(id, message) {
  errors.push({ id, message });
}
function warn(id, message) {
  warnings.push({ id, message });
}

// Today at midnight UTC. Dates in the file are plain YYYY-MM-DD.
function today() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Guard against rollover like 2026-02-30.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function isString(v) {
  return typeof v === "string" && v.length > 0;
}
function isNumberOrNull(v) {
  return v === null || (typeof v === "number" && !Number.isNaN(v));
}
function isArray(v) {
  return Array.isArray(v);
}

function requireField(id, obj, field, predicate, label) {
  if (!(field in obj)) {
    err(id, `missing required field "${field}"`);
    return false;
  }
  if (!predicate(obj[field])) {
    err(id, `field "${field}" ${label}`);
    return false;
  }
  return true;
}

function validateDeal(deal, index) {
  const id = isString(deal && deal.id) ? deal.id : `deal[${index}]`;

  if (typeof deal !== "object" || deal === null) {
    err(id, "deal is not an object");
    return;
  }

  requireField(id, deal, "id", isString, "must be a non-empty string");
  requireField(id, deal, "building", isString, "must be a non-empty string");
  requireField(id, deal, "owner", isString, "must be a non-empty string");
  requireField(id, deal, "tenant", isString, "must be a non-empty string");
  requireField(id, deal, "tenant_type", isString, "must be a non-empty string");
  requireField(id, deal, "rsf", (v) => v === null || (typeof v === "number" && v >= 0), "must be a non-negative number or null");
  requireField(id, deal, "floor_suite", (v) => v === null || isString(v), "must be a string or null");

  if (requireField(id, deal, "stage", isString, "must be a non-empty string")) {
    if (!STAGES.includes(deal.stage)) {
      err(id, `stage "${deal.stage}" is not one of: ${STAGES.join(", ")}`);
    }
  }

  if (requireField(id, deal, "ball", isString, "must be a non-empty string")) {
    if (!BALLS.includes(deal.ball)) {
      err(id, `ball "${deal.ball}" is not one of: ${BALLS.join(", ")}`);
    }
  }

  let ballSince = null;
  if (requireField(id, deal, "ball_since", isString, "must be a date string")) {
    ballSince = parseDate(deal.ball_since);
    if (!ballSince) {
      err(id, `ball_since "${deal.ball_since}" is not a valid YYYY-MM-DD date`);
    }
  }

  // clock (may be null when there is no live deadline)
  let clockDue = null;
  if (!("clock" in deal)) {
    err(id, 'missing required field "clock" (use null when there is no clock)');
  } else if (deal.clock !== null) {
    if (typeof deal.clock !== "object") {
      err(id, 'field "clock" must be an object or null');
    } else {
      const clock = deal.clock;
      requireField(id, clock, "type", isString, "must be a non-empty string");
      requireField(id, clock, "what", isString, "must be a non-empty string");
      if (requireField(id, clock, "due", isString, "must be a date string")) {
        clockDue = parseDate(clock.due);
        if (!clockDue) {
          err(id, `clock.due "${clock.due}" is not a valid YYYY-MM-DD date`);
        }
      }
    }
  }

  requireField(id, deal, "next_action", isString, "must be a non-empty string");

  // economics
  if (requireField(id, deal, "economics", (v) => typeof v === "object" && v !== null, "must be an object")) {
    const e = deal.economics;
    // ti and round are often narrative in real deals ("turn-key", "LLP8"),
    // so they accept a string as well as a number or null.
    const numStrOrNull = (v) => v === null || typeof v === "number" || typeof v === "string";
    requireField(id, e, "rate_nnn", isNumberOrNull, "must be a number or null");
    requireField(id, e, "term_mo", isNumberOrNull, "must be a number or null");
    requireField(id, e, "free_rent_mo", isNumberOrNull, "must be a number or null");
    requireField(id, e, "ti", numStrOrNull, "must be a number, string, or null");
    requireField(id, e, "ner", isNumberOrNull, "must be a number or null");
    requireField(id, e, "round", numStrOrNull, "must be a number, string, or null");
  }

  // people
  if (requireField(id, deal, "people", (v) => typeof v === "object" && v !== null, "must be an object")) {
    const p = deal.people;
    const strOrNull = (v) => v === null || isString(v);
    requireField(id, p, "tenant_broker", strOrNull, "must be a string or null");
    requireField(id, p, "ll_counsel", strOrNull, "must be a string or null");
    requireField(id, p, "owner_contact", strOrNull, "must be a string or null");
  }

  requireField(id, deal, "folder_path", isString, "must be a non-empty string");
  requireField(id, deal, "thread_subjects", isArray, "must be an array");
  requireField(id, deal, "flags", isArray, "must be an array");
  requireField(id, deal, "encumbrances", isArray, "must be an array");

  // log
  const now = today();
  let logDates = [];
  if (requireField(id, deal, "log", isArray, "must be an array")) {
    deal.log.forEach((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        err(id, `log[${i}] is not an object`);
        return;
      }
      const d = parseDate(entry.date);
      if (!d) {
        err(id, `log[${i}].date "${entry.date}" is not a valid YYYY-MM-DD date`);
      } else {
        logDates.push(d);
      }
      if (!isString(entry.event)) {
        err(id, `log[${i}].event must be a non-empty string`);
      }
      // source is the citation itself: an email id, a SharePoint doc, a
      // dated note. Any non-empty string is valid, so every entry is sourced.
      if (!isString(entry.source)) {
        err(id, `log[${i}].source must be a non-empty citation string`);
      }
      // source_id is optional, but when present (sweep-written entries) it
      // must be a non-empty string so the entry can cite its source email.
      if ("source_id" in entry && !isString(entry.source_id)) {
        err(id, `log[${i}].source_id must be a non-empty string when present`);
      }
    });
  }

  // ---- Warning-level checks (only run when the fields parsed cleanly) ----

  // 2. Stale ball = us
  if (deal.ball === "us" && ballSince) {
    const age = daysBetween(now, ballSince);
    if (age > STALE_BALL_DAYS) {
      warn(id, `ball has been "us" for ${age} days (since ${deal.ball_since}), over the ${STALE_BALL_DAYS} day limit`);
    }
  }

  // 3. Expired clock (skip terminal stages, where a clock is moot)
  const terminal = deal.stage === "executed" || deal.stage === "dead";
  if (clockDue && !terminal) {
    const overdue = daysBetween(now, clockDue);
    if (overdue > 0) {
      warn(id, `clock "${deal.clock.type}" expired ${overdue} day(s) ago (due ${deal.clock.due}): ${deal.clock.what}`);
    }
  }

  // 4. Stage / log drift
  if (STAGE_RANK[deal.stage] !== undefined && Array.isArray(deal.log)) {
    if (deal.stage !== "inquiry" && deal.log.length === 0) {
      warn(id, `stage is "${deal.stage}" but the log is empty`);
    }
    // Log dates must be chronological.
    for (let i = 1; i < logDates.length; i++) {
      if (logDates[i].getTime() < logDates[i - 1].getTime()) {
        warn(id, "log entries are not in chronological order");
        break;
      }
    }
    // Terminal stages should be recorded in the log.
    const logText = Array.isArray(deal.log)
      ? deal.log.map((e) => String(e && e.event).toLowerCase()).join(" | ")
      : "";
    if (deal.stage === "executed" && !/execut/.test(logText)) {
      warn(id, 'stage is "executed" but no log entry mentions execution');
    }
    if (deal.stage === "dead" && !/(dead|lost|declined|passed)/.test(logText)) {
      warn(id, 'stage is "dead" but no log entry mentions the deal dying');
    }
    // ball_since should not predate the first log entry.
    if (ballSince && logDates.length > 0 && daysBetween(logDates[0], ballSince) > 0) {
      warn(id, `ball_since (${deal.ball_since}) is earlier than the first log entry`);
    }
  }
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_PATH, "utf8");
  } catch (e) {
    console.error(`Could not read ${DATA_PATH}: ${e.message}`);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`deal-stack.json is not valid JSON: ${e.message}`);
    process.exit(2);
  }

  if (!data || !Array.isArray(data.deals)) {
    console.error('deal-stack.json must have a top-level "deals" array');
    process.exit(2);
  }

  // Duplicate id check.
  const seen = new Map();
  data.deals.forEach((deal, i) => {
    const id = deal && deal.id;
    if (isString(id)) {
      if (seen.has(id)) {
        err(id, `duplicate id (also at index ${seen.get(id)})`);
      } else {
        seen.set(id, i);
      }
    }
    validateDeal(deal, i);
  });

  const count = data.deals.length;
  console.log(`deal-engine validation`);
  console.log(`checked ${count} deal${count === 1 ? "" : "s"} in ${path.relative(process.cwd(), DATA_PATH)}`);
  console.log("");

  if (errors.length === 0 && warnings.length === 0) {
    console.log("All deals valid. No warnings.");
    process.exit(0);
  }

  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    for (const w of warnings) {
      console.log(`  [warn] ${w.id}: ${w.message}`);
    }
    console.log("");
  }

  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  [error] ${e.id}: ${e.message}`);
    }
    console.log("");
    console.log("Schema errors found. Fix them before committing.");
    process.exit(1);
  }

  console.log("Schema valid. Review warnings above.");
  process.exit(0);
}

main();
