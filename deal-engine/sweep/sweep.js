#!/usr/bin/env node
"use strict";

/*
 * Sweep engine: keep deal-stack.json current from a batch of fetched emails.
 *
 * Inputs (both relative to the project root):
 *   sweep/inbox-batch.json   array of { id, from, to, subject, date,
 *                            bodyPreview, attachments } fetched by Cowork
 *   data/deal-stack.json     the source of truth
 *
 * Outputs:
 *   data/deal-stack.json     updated in place, AFTER a snapshot to archive/
 *   sweep/questions.json      anything below confidence, plus new-deal candidates
 *   sweep/summary.md          what changed, what needs a ruling, drafts to stage
 *
 * Hard rules (see the brief):
 *   - Below the confidence threshold goes to questions.json. Never guess.
 *   - Never delete a deal. We only patch fields and append log entries.
 *   - Every log entry cites its source email id.
 *   - New-deal-looking emails become candidates in questions.json, not deals.
 *   - All outbound email is draft-only. This engine lists drafts, it never
 *     sends and never stages. Staging happens in Cowork.
 *
 * Flags:
 *   --dry-run   compute and print, write nothing (no snapshot, no files)
 *
 * The core is the pure runSweep() so tests can drive it without touching disk.
 */

const fs = require("fs");
const path = require("path");
const { matchEmail } = require("./lib/match");
const { classifyEmail } = require("./lib/classify");
const { buildUpdate } = require("./lib/apply");
const { snapshot } = require("../scripts/snapshot");

const ROOT = path.join(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "deal-stack.json");
const INBOX_PATH = path.join(__dirname, "inbox-batch.json");
const QUESTIONS_PATH = path.join(__dirname, "questions.json");
const SUMMARY_PATH = path.join(__dirname, "summary.md");

const DEFAULTS = {
  ourDomain: "partnersrealestate.com",
  confidenceThreshold: 0.55, // at or above: apply
  vtsThreshold: 0.2, // VTS is a trusted machine sender that always names the property
  newDealMax: 0.3, // below this with inquiry signals: new-deal candidate
};

const INQUIRY_HINTS = /\b(\d[\d,]*\s*(sf|rsf|square feet)|requirement|looking for|seeking|availabilit|space needs?|relocat|expansion|sublease|new prospect|introduc)\b/i;

function looksLikeNewInquiry(email) {
  const hay = `${email.subject || ""} ${email.bodyPreview || ""}`;
  return INQUIRY_HINTS.test(hay);
}

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

/* ------------------------------------------------------------------ *
 * Pure core
 * ------------------------------------------------------------------ */

function runSweep(dealsInput, emailsInput, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const deals = clone(dealsInput);
  const byId = new Map(deals.map((d) => [d.id, d]));

  // Process oldest first so multi-email threads compound in order.
  const emails = [...emailsInput].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const changes = [];
  const questions = [];
  const drafts = [];

  for (const email of emails) {
    const cls = classifyEmail(email, opts);
    const { best, ranked, ambiguous } = matchEmail(email, deals);
    // VTS is a trusted machine sender, so it clears at a lower bar.
    const threshold = cls.type === "vts_notification" ? opts.vtsThreshold : opts.confidenceThreshold;

    // Two deals essentially tied: never guess.
    if (ambiguous && best.confidence >= threshold) {
      questions.push({
        type: "ambiguous_match",
        email_id: email.id,
        subject: email.subject,
        from: email.from,
        note: "Two deals scored within 0.12 of each other. Which deal is this?",
        candidates: ranked.slice(0, 3),
      });
      continue;
    }

    if (best.confidence >= threshold && best.dealId) {
      const deal = byId.get(best.dealId);
      const { patch, logEntry, change, draft } = buildUpdate(deal, email, cls);

      const fromStage = deal.stage;
      Object.assign(deal, patch);
      deal.log = Array.isArray(deal.log) ? deal.log : [];
      deal.log.push(logEntry);

      changes.push({
        deal_id: deal.id,
        building: deal.building,
        suite: deal.floor_suite,
        email_id: email.id,
        confidence: Number(best.confidence.toFixed(2)),
        classification: cls.type,
        from_stage: fromStage,
        to_stage: deal.stage,
        ball: deal.ball,
        change,
        log_line: `${logEntry.date} ${logEntry.event}`,
      });

      if (draft) drafts.push(Object.assign({ deal_id: deal.id }, draft));
      continue;
    }

    // Below threshold. Decide: new-deal candidate or a ruling request.
    if (best.confidence < opts.newDealMax && looksLikeNewInquiry(email)) {
      questions.push({
        type: "new_deal_candidate",
        email_id: email.id,
        subject: email.subject,
        from: email.from,
        note: "Looks like a new inquiry with no strong match. Create a deal?",
        best_guess: best.dealId ? { deal_id: best.dealId, confidence: Number(best.confidence.toFixed(2)) } : null,
      });
    } else {
      questions.push({
        type: "low_confidence",
        email_id: email.id,
        subject: email.subject,
        from: email.from,
        note: "Below the confidence threshold. Which deal, if any?",
        best_guess: best.dealId
          ? { deal_id: best.dealId, confidence: Number(best.confidence.toFixed(2)) }
          : null,
      });
    }
  }

  const changedIds = new Set(changes.map((c) => c.deal_id));
  const summaryText = renderSummary({ changes, questions, drafts, changedIds, emails, opts });

  return { updatedDeals: deals, changes, questions, drafts, summaryText };
}

/* ------------------------------------------------------------------ *
 * Summary markdown
 * ------------------------------------------------------------------ */

function renderSummary({ changes, questions, drafts, emails, opts }) {
  const lines = [];
  const now = emails.length ? emails[emails.length - 1].date : "";
  lines.push(`# Sweep summary`);
  lines.push("");
  lines.push(
    `Processed ${emails.length} email(s). ${changes.length} applied, ${questions.length} need a ruling, ${drafts.length} draft(s) to stage.`
  );
  lines.push("");

  lines.push(`## What changed`);
  if (changes.length === 0) {
    lines.push("Nothing applied this run.");
  } else {
    for (const c of changes) {
      const move = c.from_stage === c.to_stage ? c.to_stage : `${c.from_stage} -> ${c.to_stage}`;
      lines.push(
        `- **${c.building}** ${suiteShort(c.suite)} [${move}, ball: ${c.ball}] conf ${c.confidence}, src ${c.email_id}`
      );
      lines.push(`  - ${c.log_line}`);
    }
  }
  lines.push("");

  lines.push(`## What needs you`);
  if (questions.length === 0) {
    lines.push("Nothing. No rulings needed.");
  } else {
    for (const q of questions) {
      const guess = q.best_guess ? ` (best guess ${q.best_guess.deal_id} @ ${q.best_guess.confidence})` : "";
      lines.push(`- [${q.type}] ${trimSubject(q.subject)} from ${q.from}${guess}`);
      lines.push(`  - ${q.note} See questions.json (email ${q.email_id}).`);
    }
  }
  lines.push("");

  lines.push(`## Drafts to stage (list only, draft-only, you are the only sender)`);
  if (drafts.length === 0) {
    lines.push("None.");
  } else {
    for (const d of drafts) {
      lines.push(`- To ${d.to} re ${d.deal_id}: "${d.subject}"`);
      lines.push(`  - Purpose: ${d.purpose}`);
    }
  }
  lines.push("");
  lines.push(`_Threshold ${opts.confidenceThreshold}. Generated by sweep.js${now ? ", latest email " + now : ""}._`);
  lines.push("");
  return lines.join("\n");
}

function suiteShort(fs) {
  const m = String(fs || "").match(/suite\s*([\w-]+)/i);
  return m ? "Ste " + m[1] : String(fs || "");
}
function trimSubject(s) {
  const out = String(s || "").replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim();
  return out.length > 70 ? out.slice(0, 67) + "..." : out;
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main() {
  const dryRun = process.argv.includes("--dry-run");

  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  if (!fs.existsSync(INBOX_PATH)) {
    console.error(`No inbox batch at ${path.relative(ROOT, INBOX_PATH)}. Nothing to sweep.`);
    process.exit(1);
  }
  const emails = JSON.parse(fs.readFileSync(INBOX_PATH, "utf8"));
  if (!Array.isArray(emails)) {
    console.error("inbox-batch.json must be an array of emails.");
    process.exit(1);
  }

  const result = runSweep(data.deals || [], emails, {});

  if (dryRun) {
    console.log(result.summaryText);
    console.log("\n(dry run: no files written)");
    return;
  }

  // Snapshot BEFORE writing. This is the undo point.
  const snap = snapshot({ label: "presweep" });

  data.deals = result.updatedDeals;
  data.meta = data.meta || {};
  const latest = emails.map((e) => e.date).filter(Boolean).sort().pop();
  if (latest) data.meta.last_updated = latest;
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + "\n");

  fs.writeFileSync(QUESTIONS_PATH, JSON.stringify(result.questions, null, 2) + "\n");
  fs.writeFileSync(SUMMARY_PATH, result.summaryText);

  console.log(`Snapshot: ${path.relative(ROOT, snap)}`);
  console.log(
    `Applied ${result.changes.length}, ${result.questions.length} question(s), ${result.drafts.length} draft(s).`
  );
  console.log(`Wrote data/deal-stack.json, sweep/questions.json, sweep/summary.md`);
}

if (require.main === module) main();

module.exports = { runSweep, looksLikeNewInquiry, DEFAULTS };
