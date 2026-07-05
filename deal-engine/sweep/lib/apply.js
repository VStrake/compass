"use strict";

/*
 * Turn a (deal, email, classification) into a concrete update: the field
 * patch, the terse log entry that cites the source email, a human summary of
 * what changed, and an optional draft suggestion (list only, never sent).
 *
 * Pure. No IO. The caller applies the patch to a copy of the deal.
 */

const { emailDomain } = require("./text");

const STAGE_RANK = {
  inquiry: 0,
  touring: 1,
  proposal_out: 2,
  negotiating: 3,
  loi_agreed: 4,
  legal: 5,
  lease_out: 6,
  executed: 7,
  dead: 8,
};

function addDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Do not regress the funnel: only move a stage forward.
function advance(current, target) {
  if (STAGE_RANK[target] === undefined) return current;
  return STAGE_RANK[target] > STAGE_RANK[current] ? target : current;
}

function orgFromDomain(domain) {
  const base = String(domain || "").split(".")[0];
  if (!base) return "";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// A short label for the counterparty in log phrasing.
function counterparty(deal, email) {
  const broker = (deal.people && deal.people.tenant_broker) || "";
  if (broker && !/placeholder/i.test(broker)) return shortName(broker);
  const org = orgFromDomain(emailDomain(email.from));
  return org || "broker";
}

function shortName(name) {
  // "Jordan Kim, Savills" -> "Savills" if a firm is present, else the name.
  const parts = String(name).split(",").map((s) => s.trim());
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

// Build the result for an applied event.
function buildUpdate(deal, email, cls) {
  const date = email.date;
  const cp = counterparty(deal, email);
  const patch = {};
  let event = "";
  let change = "";
  let draft = null;

  switch (cls.type) {
    case "proposal_round": {
      const detected = cls.round;
      const isRedline = cls.kind === "redline";
      const tag = cls.docTag || (cls.kind === "counter" ? "Counter" : "Proposal");
      if (cls.direction === "outbound") {
        // We sent it out. Ball goes to the other side.
        if (isRedline) {
          patch.stage = advance(deal.stage, "legal");
          patch.ball = "attorney";
          event = `${tag} sent to ${cp} counsel.`;
        } else {
          patch.stage = advance(deal.stage, cls.kind === "counter" ? "negotiating" : "proposal_out");
          patch.ball = "tenant";
          event = `${tag} sent to ${cp}.`;
        }
        patch.clock = { type: "proposal_response", due: addDays(date, 7), what: `Await ${cp} response to ${tag}` };
        patch.next_action = `Await ${cp} response to ${tag}.`;
      } else {
        // Inbound. It landed on our desk.
        if (isRedline) {
          patch.stage = advance(deal.stage, "legal");
          patch.ball = "us";
          event = `Redline received from ${cp} counsel.`;
          patch.clock = { type: "lease_review", due: addDays(date, 5), what: "Review redline" };
          patch.next_action = "Review redline, turn comments.";
        } else {
          patch.stage = advance(deal.stage, "negotiating");
          patch.ball = "us";
          event = `${cls.kind === "llp" ? "Marked-up proposal" : "Counter"} received from ${cp}.`;
          patch.clock = { type: "internal_review", due: addDays(date, 3), what: "Review counter" };
          patch.next_action = `Review ${cp} counter, respond.`;
        }
        draft = {
          to: cp,
          subject: `${deal.building} ${suite(deal)} - response`,
          purpose: patch.next_action,
        };
      }
      // Round bookkeeping.
      const nextRound =
        detected != null
          ? detected
          : isRedline
          ? (deal.economics && deal.economics.round) || 0
          : ((deal.economics && deal.economics.round) || 0) + 1;
      patch.economics = Object.assign({}, deal.economics, { round: nextRound });
      change = event;
      break;
    }

    case "executed": {
      patch.stage = "executed";
      patch.ball = "us";
      patch.clock = { type: "closed", due: date, what: "Lease executed" };
      patch.next_action = "None. Lease executed.";
      event = "Lease fully executed.";
      change = event;
      break;
    }

    case "approval_cleared": {
      patch.ball = "us";
      patch.clock = { type: "followup", due: addDays(date, 3), what: "Advance per approval" };
      patch.next_action = "Advance per approval.";
      event = "Owner approval cleared.";
      change = event;
      draft = {
        to: cp,
        subject: `${deal.building} ${suite(deal)} - next steps`,
        purpose: "Notify counterparty approval cleared, propose next step.",
      };
      break;
    }

    case "meeting_set": {
      patch.stage = advance(deal.stage, "touring");
      patch.ball = "tenant";
      const when = cls.when || addDays(date, 5);
      patch.clock = { type: "tour", due: when, what: "Tour scheduled" };
      patch.next_action = "Prepare space and materials for tour.";
      event = `Tour set ${slash(when)}.`;
      change = event;
      break;
    }

    case "receipt": {
      event = "Receipt confirmed.";
      change = "Receipt confirmed (no stage change).";
      break;
    }

    case "vts_notification": {
      const credit = cls.teammate ? ` (credit ${cls.teammate})` : "";
      event = `VTS: ${trim(email.subject)}${credit}.`;
      change = `VTS note folded in${credit}.`;
      break;
    }

    default: {
      event = trim(email.subject) + ".";
      change = "Generic update logged (no stage change).";
    }
  }

  // ball_since resets whenever ball changes.
  if (patch.ball && patch.ball !== deal.ball) {
    patch.ball_since = date;
  }

  const source = cls.type === "vts_notification" ? "vts" : "email";
  const logEntry = { date, event, source, source_id: email.id };

  return { patch, logEntry, change, draft };
}

function suite(deal) {
  const m = String(deal.floor_suite || "").match(/suite\s*([\w-]+)/i);
  return m ? "Ste " + m[1] : "";
}

function slash(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function trim(s) {
  let out = String(s || "").replace(/^\s*(re|fw|fwd)\s*:\s*/i, "").trim();
  return out.length > 60 ? out.slice(0, 57) + "..." : out;
}

module.exports = { buildUpdate, addDays, advance, STAGE_RANK };
