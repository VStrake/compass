#!/usr/bin/env node
"use strict";

/*
 * Snapshot deal-stack.json into archive/ with a timestamp. This is the undo
 * button: the sweep calls snapshot() before it writes, so every automated
 * change to the stack has a restore point.
 *
 * CLI:   node scripts/snapshot.js            take a snapshot now
 *        node scripts/snapshot.js --list     list snapshots, newest first
 * Module: const { snapshot } = require("./snapshot"); snapshot();
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "deal-stack.json");
const ARCHIVE_DIR = path.join(ROOT, "archive");

// 2026-07-05T18-42-07 style stamp, filesystem safe, sorts chronologically.
function stamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

function snapshot(opts) {
  const o = opts || {};
  const src = o.src || DATA_PATH;
  const dir = o.dir || ARCHIVE_DIR;
  const label = o.label ? `_${o.label}` : "";

  if (!fs.existsSync(src)) {
    throw new Error(`Nothing to snapshot, ${src} does not exist`);
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const name = `deal-stack.${stamp(o.date)}${label}.json`;
  const dest = path.join(dir, name);
  fs.copyFileSync(src, dest);
  return dest;
}

function list() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.startsWith("deal-stack.") && f.endsWith(".json"))
    .sort()
    .reverse();
}

if (require.main === module) {
  if (process.argv.includes("--list")) {
    const files = list();
    if (!files.length) {
      console.log("No snapshots in archive/.");
    } else {
      console.log(`${files.length} snapshot(s), newest first:`);
      files.forEach((f) => console.log("  " + f));
    }
  } else {
    try {
      const dest = snapshot({ label: process.argv[2] && !process.argv[2].startsWith("-") ? process.argv[2] : "" });
      console.log("Snapshot written: " + path.relative(ROOT, dest));
    } catch (e) {
      console.error("snapshot failed: " + e.message);
      process.exit(1);
    }
  }
}

module.exports = { snapshot, list, stamp };
