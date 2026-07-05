"use strict";

/*
 * Classify what an email represents. Pure function of the email plus who we
 * are (OUR_DOMAIN, so we can tell an email we sent from one we received).
 *
 * Returns { type, direction, ...detail }. Types:
 *   proposal_round     LLP / counter / redline moving between the parties
 *   approval_cleared   an approval landed (owner or internal)
 *   receipt            a plain "got it / confirming receipt"
 *   meeting_set        a tour or meeting was scheduled
 *   executed           lease fully executed / countersigned
 *   vts_notification   automated note from viewthespace.com
 *   generic_update     none of the above, still logged
 */

const { normalizeSubject, emailDomain } = require("./text");

const VTS_DOMAIN = "viewthespace.com";

function attachmentNames(email) {
  return (email.attachments || []).map((a) => String(a).toLowerCase());
}

function anyMatch(strings, re) {
  return strings.some((s) => re.test(s));
}

function classifyEmail(email, opts) {
  const ourDomain = (opts && opts.ourDomain) || "";
  const from = emailDomain(email.from);
  const direction = ourDomain && from === ourDomain ? "outbound" : "inbound";
  const subject = normalizeSubject(email.subject);
  const body = normalizeSubject(email.bodyPreview);
  const hay = `${subject} ${body}`;
  const atts = attachmentNames(email);

  // VTS first, it is a distinct machine sender.
  if (from === VTS_DOMAIN || /viewthespace/.test(from)) {
    return { type: "vts_notification", direction: "inbound", teammate: extractTeammate(email) };
  }

  // Executed / countersigned.
  if (/\b(fully executed|executed lease|countersigned|lease executed|execution)\b/.test(hay)) {
    return { type: "executed", direction };
  }

  // Proposal / counter / redline, driven by attachment names then subject.
  const docTag = detectDocTag(atts) || detectDocTag([subject]);
  if (docTag) {
    return {
      type: "proposal_round",
      direction,
      docTag: docTag.tag,
      kind: docTag.kind, // "llp" | "counter" | "redline"
      round: docTag.round,
    };
  }

  // Approval cleared.
  if (/\b(approved|approval|signed off|good to go|cleared)\b/.test(hay)) {
    return { type: "approval_cleared", direction };
  }

  // Meeting / tour scheduled.
  if (/\b(tour|meeting|showing|walk through|walkthrough|scheduled|calendar invite|confirmed for)\b/.test(hay)) {
    return { type: "meeting_set", direction, when: extractDate(hay) };
  }

  // Plain receipt confirmation.
  if (/\b(received|confirming receipt|receipt|got it|thanks for sending|acknowledge)\b/.test(hay)) {
    return { type: "receipt", direction };
  }

  return { type: "generic_update", direction };
}

// LLP1, LLP 2, counter, redline in a set of strings.
function detectDocTag(strings) {
  for (const s of strings) {
    const llp = s.match(/llp\s*(\d+)?/i);
    if (llp) return { tag: `LLP${llp[1] || ""}`.trim(), kind: "llp", round: num(llp[1]) };
    if (/redline/i.test(s)) return { tag: "redline", kind: "redline", round: null };
    if (/counter/i.test(s)) return { tag: "counter", kind: "counter", round: null };
  }
  return null;
}

function num(x) {
  const n = parseInt(x, 10);
  return Number.isNaN(n) ? null : n;
}

// Best-effort teammate credit from a VTS body ("Tour logged by Jordan Kim").
function extractTeammate(email) {
  const body = `${email.subject || ""} ${email.bodyPreview || ""}`;
  const m = body.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  return m ? m[1] : null;
}

// Best-effort date pull, returns YYYY-MM-DD or null.
function extractDate(hay) {
  const m = hay.match(/\b(\d{1,2})[/](\d{1,2})[/](\d{2,4})\b/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? "20" + yy : yy;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

module.exports = { classifyEmail, VTS_DOMAIN };
