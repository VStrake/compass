"use strict";

/* Text normalization and fuzzy helpers shared by matching and classification. */

const STOP_TOKENS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "for",
  "to",
  "re",
  "fw",
  "fwd",
  "llc",
  "lp",
  "inc",
  "co",
  "ltd",
  "placeholder",
  "tenant",
  "suite",
  "floor",
  "ste",
]);

// Strip RE:/FW: prefixes (repeated), lowercase, drop punctuation, collapse space.
function normalizeSubject(s) {
  let out = String(s || "").toLowerCase();
  let prev;
  do {
    prev = out;
    out = out.replace(/^\s*(re|fw|fwd)\s*:\s*/i, "");
  } while (out !== prev);
  out = out.replace(/\[[^\]]*\]/g, " "); // [EXTERNAL] tags etc.
  out = out.replace(/[^a-z0-9]+/g, " ").trim();
  return out.replace(/\s+/g, " ");
}

function tokens(s) {
  return normalizeSubject(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_TOKENS.has(t));
}

// Meaningful tokens from a name (tenant, broker), stopwords removed.
function nameTokens(name) {
  return tokens(name);
}

// Jaccard token overlap of two strings, 0..1.
function tokenOverlap(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / new Set([...ta, ...tb]).size;
}

function emailDomain(addr) {
  const m = String(addr || "").match(/@([^\s>]+)/);
  return m ? m[1].toLowerCase() : "";
}

function containsAll(haystack, needleTokens) {
  const h = " " + normalizeSubject(haystack) + " ";
  return needleTokens.every((t) => h.includes(" " + t + " "));
}

function containsAny(haystack, needleTokens) {
  const h = " " + normalizeSubject(haystack) + " ";
  return needleTokens.some((t) => h.includes(" " + t + " "));
}

module.exports = {
  normalizeSubject,
  tokens,
  nameTokens,
  tokenOverlap,
  emailDomain,
  containsAll,
  containsAny,
};
