"use strict";

/*
 * Match an email to a deal and score the confidence.
 *
 * Signals, each additive, capped at 1.0:
 *   - thread_subject fingerprint hit           strong
 *   - subject token overlap with a fingerprint  partial
 *   - tenant name tokens present in the email    medium
 *   - building name present in the email         medium
 *   - broker name echoed in the sender domain    medium
 *
 * Returns { dealId, confidence, signals } for the best deal, plus the full
 * ranking so the caller can spot ambiguity (two close matches).
 */

const {
  normalizeSubject,
  nameTokens,
  tokenOverlap,
  emailDomain,
  containsAll,
} = require("./text");

const WEIGHTS = {
  fingerprintExact: 0.7,
  fingerprintPartial: 0.3, // scaled by overlap
  tenant: 0.25,
  building: 0.2,
  brokerDomain: 0.25,
  suite: 0.15,
};

// "Ground floor, Suite G10" -> "g10"; "22nd floor, full floor" -> "full".
function suiteToken(floorSuite) {
  const s = String(floorSuite || "");
  const m = s.match(/suite\s*([\w-]+)/i);
  if (m) return m[1].toLowerCase();
  if (/full floor/i.test(s)) return "full";
  return "";
}

function scoreDealAgainstEmail(deal, email) {
  const signals = [];
  let score = 0;

  const subjectNorm = normalizeSubject(email.subject);
  const haystack = `${email.subject || ""} ${email.bodyPreview || ""}`;

  // 1. thread_subject fingerprints
  let bestFp = 0;
  for (const fp of deal.thread_subjects || []) {
    const fpNorm = normalizeSubject(fp);
    if (!fpNorm) continue;
    if (subjectNorm === fpNorm || subjectNorm.includes(fpNorm) || fpNorm.includes(subjectNorm)) {
      bestFp = Math.max(bestFp, WEIGHTS.fingerprintExact);
    } else {
      bestFp = Math.max(bestFp, tokenOverlap(email.subject, fp) * WEIGHTS.fingerprintPartial);
    }
  }
  if (bestFp > 0) {
    score += bestFp;
    signals.push(`subject(${bestFp.toFixed(2)})`);
  }

  // 2. tenant name tokens
  const tTokens = nameTokens(deal.tenant);
  if (tTokens.length && containsAll(haystack, tTokens)) {
    score += WEIGHTS.tenant;
    signals.push("tenant");
  }

  // 3. building name
  const bTokens = nameTokens(deal.building);
  if (bTokens.length && containsAll(haystack, bTokens)) {
    score += WEIGHTS.building;
    signals.push("building");
  }

  // 3b. suite number present in the email (e.g. "Suite G10", "Ste 200")
  const st = suiteToken(deal.floor_suite);
  if (st && st !== "full") {
    const h = " " + normalizeSubject(haystack) + " ";
    if (h.includes(" " + st + " ")) {
      score += WEIGHTS.suite;
      signals.push("suite");
    }
  }

  // 4. broker name echoed in sender domain (e.g. broker "Savills" -> savills.com)
  const domain = emailDomain(email.from);
  const brokerToks = nameTokens((deal.people && deal.people.tenant_broker) || "");
  if (domain && brokerToks.some((t) => t.length >= 4 && domain.includes(t))) {
    score += WEIGHTS.brokerDomain;
    signals.push("brokerDomain");
  }

  return { dealId: deal.id, confidence: Math.min(1, score), signals };
}

function matchEmail(email, deals) {
  const ranked = deals
    .map((d) => scoreDealAgainstEmail(d, email))
    .sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0] || { dealId: null, confidence: 0, signals: [] };
  const runnerUp = ranked[1] || { confidence: 0 };
  return {
    best,
    ranked,
    ambiguous: best.confidence > 0 && best.confidence - runnerUp.confidence < 0.12,
  };
}

module.exports = { matchEmail, scoreDealAgainstEmail, WEIGHTS };
