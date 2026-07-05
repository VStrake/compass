import { ensureAuth } from "./auth.js";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const STAGES = [
  "inquiry",
  "touring",
  "proposal_out",
  "negotiating",
  "loi_agreed",
  "legal",
  "lease_out",
  "executed",
];
// "dead" is tracked but sits outside the funnel.

const STAGE_LABEL = {
  inquiry: "Inquiry",
  touring: "Touring",
  proposal_out: "Proposal Out",
  negotiating: "Negotiating",
  loi_agreed: "LOI Agreed",
  legal: "Legal",
  lease_out: "Lease Out",
  executed: "Executed",
  dead: "Dead",
};

const BALL_LABEL = {
  us: "Us",
  tenant: "Tenant",
  attorney: "Attorney",
  owner: "Owner",
  client: "Client",
};

// Stage -> suite status bucket for the stacking diagram.
function statusForStage(stage) {
  if (stage === "executed") return "leased";
  if (stage === "legal" || stage === "lease_out") return "legal";
  if (stage === "loi_agreed" || stage === "negotiating" || stage === "proposal_out")
    return "proposal";
  if (stage === "touring" || stage === "inquiry") return "touring";
  return "vacant"; // dead
}

const STATUS_LABEL = {
  leased: "Leased",
  proposal: "In proposal",
  legal: "In legal",
  touring: "Touring / inquiry",
  vacant: "Vacant / dead",
};

const STATUS_VAR = {
  leased: "--status-leased",
  proposal: "--status-proposal",
  legal: "--status-legal",
  touring: "--status-touring",
  vacant: "--status-vacant",
};

// Funnel bar color per stage.
const STAGE_VAR = {
  inquiry: "--status-inquiry",
  touring: "--status-touring",
  proposal_out: "--status-proposal",
  negotiating: "--status-proposal",
  loi_agreed: "--status-proposal",
  legal: "--status-legal",
  lease_out: "--status-legal",
  executed: "--status-leased",
  dead: "--status-dead",
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

let DEALS = [];
let META = {};
const filters = { building: "", owner: "" };

/* ------------------------------------------------------------------ *
 * Date and format helpers
 * ------------------------------------------------------------------ */

function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function parseDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function daysBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

// positive = that many days ago
function daysSince(s) {
  const d = parseDate(s);
  return d ? daysBetween(todayUTC(), d) : null;
}

// positive = that many days from now, negative = overdue
function daysUntil(s) {
  const d = parseDate(s);
  return d ? daysBetween(d, todayUTC()) : null;
}

function fmtDate(s) {
  const d = parseDate(s);
  if (!d) return s || "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtSF(n) {
  if (typeof n !== "number") return "-";
  return n.toLocaleString("en-US") + " SF";
}

function money(n) {
  if (n === null || n === undefined || n === "") return "-";
  // Some economics fields carry narrative values (ti: "turn-key",
  // round: "LLP8"). Numbers get formatted; strings pass through as written.
  if (typeof n !== "number") return String(n);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// Urgency class from a due date. Overdue or <=2 days = red, <=5 = amber, else green.
function clockUrgency(dueStr) {
  const u = daysUntil(dueStr);
  if (u === null) return { cls: "", text: "no clock", rank: 9999 };
  if (u < 0) return { cls: "urg-red", text: `overdue ${-u}d`, rank: u };
  if (u <= 2) return { cls: "urg-red", text: `${u}d left`, rank: u };
  if (u <= 5) return { cls: "urg-amber", text: `${u}d left`, rank: u };
  return { cls: "urg-green", text: `${u}d left`, rank: u };
}

function cssVar(name) {
  return `var(${name})`;
}

/* ------------------------------------------------------------------ *
 * Filtering
 * ------------------------------------------------------------------ */

function applyFilters(deals) {
  return deals.filter((d) => {
    if (filters.building && d.building !== filters.building) return false;
    if (filters.owner && d.owner !== filters.owner) return false;
    return true;
  });
}

function uniqueSorted(key) {
  return [...new Set(DEALS.map((d) => d[key]).filter(Boolean))].sort();
}

function filterBar() {
  const buildings = uniqueSorted("building");
  const owners = uniqueSorted("owner");
  const opt = (v, sel) =>
    `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v || "")}</option>`;
  return `
    <div class="filters">
      <select id="f-building">
        <option value="">All buildings</option>
        ${buildings.map((b) => opt(b, filters.building)).join("")}
      </select>
      <select id="f-owner">
        <option value="">All owners</option>
        ${owners.map((o) => opt(o, filters.owner)).join("")}
      </select>
    </div>`;
}

function wireFilters() {
  const b = document.getElementById("f-building");
  const o = document.getElementById("f-owner");
  if (b)
    b.addEventListener("change", (e) => {
      filters.building = e.target.value;
      render();
    });
  if (o)
    o.addEventListener("change", (e) => {
      filters.owner = e.target.value;
      render();
    });
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

function ballChip(deal) {
  const since = daysSince(deal.ball_since);
  const stale = deal.ball === "us" && since !== null && since > 3;
  const days = since === null ? "" : ` ${since}d`;
  return `<span class="chip ${stale ? "pill-red" : "ball"}">${esc(
    BALL_LABEL[deal.ball] || deal.ball
  )}${days}</span>`;
}

function dealCard(deal) {
  const u = clockUrgency(deal.clock && deal.clock.due);
  return `
    <button class="card" data-nav="#/deal/${encodeURIComponent(deal.id)}">
      <div class="row">
        <span class="title">${esc(deal.building)}</span>
        <span class="chip" style="background:${cssVar(
          STAGE_VAR[deal.stage]
        )};color:#fff">${esc(STAGE_LABEL[deal.stage] || deal.stage)}</span>
      </div>
      <div class="meta">${esc(deal.tenant)} &middot; ${esc(deal.floor_suite)} &middot; ${fmtSF(
        deal.rsf
      )}</div>
      <div class="row line">
        ${ballChip(deal)}
        <span class="chip ${u.cls}">${esc(deal.clock ? deal.clock.type : "")} &middot; ${
    u.text
  }</span>
      </div>
    </button>`;
}

/* ------------------------------------------------------------------ *
 * View: Attention (default)
 * ------------------------------------------------------------------ */

function viewAttention() {
  const ours = applyFilters(DEALS)
    .filter((d) => d.ball === "us" && d.stage !== "dead" && d.stage !== "executed")
    .sort((a, b) => {
      const ua = clockUrgency(a.clock && a.clock.due).rank;
      const ub = clockUrgency(b.clock && b.clock.due).rank;
      return ua - ub;
    });

  const body = ours.length
    ? ours.map(dealCard).join("")
    : `<div class="empty">Nothing in your court. Clear desk.</div>`;

  return `
    <header class="top">
      <h1>Attention</h1>
      <div class="sub">Ball in your court, most urgent first</div>
    </header>
    ${filterBar()}
    ${body}`;
}

/* ------------------------------------------------------------------ *
 * View: Pipeline funnel
 * ------------------------------------------------------------------ */

function viewPipeline() {
  const deals = applyFilters(DEALS);
  const byStage = {};
  for (const s of STAGES) byStage[s] = { count: 0, sf: 0, deals: [] };
  let maxCount = 1;
  for (const d of deals) {
    if (!byStage[d.stage]) continue; // dead excluded from funnel
    byStage[d.stage].count += 1;
    byStage[d.stage].sf += typeof d.rsf === "number" ? d.rsf : 0;
    byStage[d.stage].deals.push(d);
    if (byStage[d.stage].count > maxCount) maxCount = byStage[d.stage].count;
  }

  const rows = STAGES.map((s) => {
    const c = byStage[s].count;
    const w = Math.max(12, Math.round((c / maxCount) * 100));
    return `
      <div class="stage">
        <span class="label">${esc(STAGE_LABEL[s])}</span>
        <div class="bar" style="width:${w}%;background:${cssVar(STAGE_VAR[s])}">
          ${c}
        </div>
        <span class="count">${fmtSF(byStage[s].sf)}</span>
      </div>`;
  }).join("");

  const deadCount = deals.filter((d) => d.stage === "dead").length;

  // Deals under the funnel, grouped, tappable.
  const active = deals
    .filter((d) => d.stage !== "dead")
    .sort((a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  const list = active.length
    ? active.map(dealCard).join("")
    : `<div class="empty">No deals match these filters.</div>`;

  return `
    <header class="top">
      <h1>Pipeline</h1>
      <div class="sub">${active.length} active${
    deadCount ? ` &middot; ${deadCount} dead` : ""
  }</div>
    </header>
    ${filterBar()}
    <div class="funnel">${rows}</div>
    <div class="section-title">Deals</div>
    ${list}`;
}

/* ------------------------------------------------------------------ *
 * View: Buildings (stacking diagrams)
 * ------------------------------------------------------------------ */

// Pull a sortable floor number out of "18th floor, Suite 1800" etc.
function floorRank(floorSuite) {
  const s = String(floorSuite || "").toLowerCase();
  if (s.includes("ground")) return 0;
  const m = s.match(/(\d+)(?:st|nd|rd|th)?\s*floor/);
  if (m) return parseInt(m[1], 10);
  const any = s.match(/\d+/);
  return any ? parseInt(any[0], 10) : -1;
}

function stackLegend() {
  return `<div class="legend">${["leased", "proposal", "legal", "touring", "vacant"]
    .map(
      (k) =>
        `<span><i class="chip" style="width:10px;height:10px;padding:0;background:${cssVar(
          STATUS_VAR[k]
        )}"></i>${esc(STATUS_LABEL[k])}</span>`
    )
    .join("")}</div>`;
}

function viewBuildings() {
  const deals = filters.owner
    ? DEALS.filter((d) => d.owner === filters.owner)
    : DEALS;
  const buildings = [...new Set(deals.map((d) => d.building))].sort();

  const blocks = buildings
    .map((bld) => {
      const bd = deals
        .filter((d) => d.building === bld)
        .sort((a, b) => floorRank(b.floor_suite) - floorRank(a.floor_suite));
      const owner = bd[0] ? bd[0].owner : "";
      const floors = bd
        .map((d) => {
          const st = statusForStage(d.stage);
          const enc = Array.isArray(d.encumbrances) && d.encumbrances.length;
          return `
            <button class="floor" data-nav="#/deal/${encodeURIComponent(d.id)}">
              <span class="fl">${esc(shortFloor(d.floor_suite))}</span>
              <span class="box" style="background:${cssVar(STATUS_VAR[st])}">
                <span>${esc(d.tenant)} &middot; ${fmtSF(d.rsf)}</span>
                ${enc ? '<span class="warn" title="Encumbrance">&#9888;</span>' : ""}
              </span>
            </button>`;
        })
        .join("");
      return `
        <div class="stack">
          <div class="bld">${esc(bld)}</div>
          <div class="own">Owner: ${esc(owner)}</div>
          ${floors}
        </div>`;
    })
    .join("");

  return `
    <header class="top">
      <h1>Buildings</h1>
      <div class="sub">Stacking by tracked suite</div>
    </header>
    ${filterBar()}
    ${stackLegend()}
    ${blocks || '<div class="empty">No buildings match these filters.</div>'}`;
}

function shortFloor(floorSuite) {
  const r = floorRank(floorSuite);
  if (r === 0) return "Grnd";
  if (r > 0) return "Fl " + r;
  return "-";
}

/* ------------------------------------------------------------------ *
 * View: Deal detail
 * ------------------------------------------------------------------ */

function viewDeal(id) {
  const deal = DEALS.find((d) => d.id === id);
  if (!deal) {
    return `<a class="back" data-nav="#/attention">&larr; Back</a>
      <div class="empty">Deal not found.</div>`;
  }

  const e = deal.economics || {};
  const p = deal.people || {};
  const since = daysSince(deal.ball_since);
  const u = clockUrgency(deal.clock && deal.clock.due);

  const econ = `
    <div class="section">
      <h3>Economics</h3>
      <div class="kv">
        <div><div class="k">Rate (NNN)</div><div class="v">${money(e.rate_nnn)}</div></div>
        <div><div class="k">NER</div><div class="v big">${money(e.ner)}</div></div>
        <div><div class="k">Term</div><div class="v">${
          e.term_mo != null ? e.term_mo + " mo" : "-"
        }</div></div>
        <div><div class="k">Free rent</div><div class="v">${
          e.free_rent_mo != null ? e.free_rent_mo + " mo" : "-"
        }</div></div>
        <div><div class="k">TI</div><div class="v">${money(e.ti)}</div></div>
        <div><div class="k">Round</div><div class="v">${
          e.round != null ? e.round : "-"
        }</div></div>
      </div>
    </div>`;

  const status = `
    <div class="section">
      <h3>Status</h3>
      <div class="kv">
        <div><div class="k">Stage</div><div class="v">${esc(
          STAGE_LABEL[deal.stage] || deal.stage
        )}</div></div>
        <div><div class="k">Ball in court</div><div class="v ${
          deal.ball === "us" && since > 3 ? "urg-red" : ""
        }">${esc(BALL_LABEL[deal.ball] || deal.ball)}${
    since != null ? ` &middot; ${since}d` : ""
  }</div></div>
        <div>
          <div class="k">Clock &middot; ${esc(deal.clock ? deal.clock.type : "")}</div>
          <div class="v ${u.cls}">${esc(u.text)}</div>
        </div>
        <div><div class="k">Due</div><div class="v">${fmtDate(
          deal.clock && deal.clock.due
        )}</div></div>
      </div>
      <div class="line" style="margin-top:10px">
        <div class="k">What</div>
        <div>${esc(deal.clock ? deal.clock.what : "")}</div>
      </div>
      <div class="line" style="margin-top:10px">
        <div class="k">Next action</div>
        <div>${esc(deal.next_action)}</div>
      </div>
    </div>`;

  const people = `
    <div class="section">
      <h3>People</h3>
      <div class="kv">
        <div><div class="k">Tenant broker</div><div class="v" style="font-size:14px">${esc(
          p.tenant_broker || "-"
        )}</div></div>
        <div><div class="k">LL counsel</div><div class="v" style="font-size:14px">${esc(
          p.ll_counsel || "-"
        )}</div></div>
        <div><div class="k">Owner contact</div><div class="v" style="font-size:14px">${esc(
          p.owner_contact || "-"
        )}</div></div>
      </div>
    </div>`;

  const enc =
    Array.isArray(deal.encumbrances) && deal.encumbrances.length
      ? deal.encumbrances
          .map((x) => `<div class="encumbrance"><span>&#9888;</span><span>${esc(x)}</span></div>`)
          .join("")
      : "";
  const flags =
    Array.isArray(deal.flags) && deal.flags.length
      ? `<div class="line">${deal.flags
          .map((f) => `<span class="chip ball">${esc(f)}</span>`)
          .join(" ")}</div>`
      : "";

  const log =
    Array.isArray(deal.log) && deal.log.length
      ? [...deal.log]
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map(
            (l) => `
        <div class="log-entry">
          <span class="when">${fmtDate(l.date)}</span>
          <span class="what">${esc(l.event)}</span>
          <span class="src">${esc(l.source)}</span>
        </div>`
          )
          .join("")
      : `<div class="empty">No activity logged.</div>`;

  const docs = `
    <div class="section">
      <h3>Documents</h3>
      <div class="doc-link">&#128193; <span>${esc(deal.folder_path || "-")}</span></div>
      ${
        Array.isArray(deal.thread_subjects) && deal.thread_subjects.length
          ? `<div class="k" style="margin-top:10px">Email threads</div>` +
            deal.thread_subjects
              .map((t) => `<div class="line" style="font-size:13px">&#9993; ${esc(t)}</div>`)
              .join("")
          : ""
      }
    </div>`;

  return `
    <a class="back" data-nav="#/pipeline">&larr; Pipeline</a>
    <div class="detail">
      <h2>${esc(deal.building)}</h2>
      <div class="sub">${esc(deal.tenant)} &middot; ${esc(deal.tenant_type)} &middot; ${esc(
    deal.floor_suite
  )} &middot; ${fmtSF(deal.rsf)}</div>
      ${flags}
      ${enc}
      ${status}
      ${econ}
      ${people}
      <div class="section">
        <h3>Activity log</h3>
        ${log}
      </div>
      ${docs}
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Navigation shell
 * ------------------------------------------------------------------ */

function attentionCount() {
  return DEALS.filter(
    (d) => d.ball === "us" && d.stage !== "dead" && d.stage !== "executed"
  ).length;
}

function tabs(active) {
  const n = attentionCount();
  const item = (route, ico, label, badge) => `
    <button data-nav="#/${route}" class="${active === route ? "active" : ""}">
      <span class="ico">${ico}</span>
      <span>${label}</span>
      ${badge ? `<span class="badge">${badge}</span>` : ""}
    </button>`;
  return `
    <nav class="tabs">
      ${item("attention", "&#9873;", "Attention", n)}
      ${item("pipeline", "&#9776;", "Pipeline", 0)}
      ${item("buildings", "&#127970;", "Buildings", 0)}
    </nav>`;
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { name: parts[0] || "attention", arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function render() {
  const app = document.getElementById("app");
  const { name, arg } = parseRoute();
  let html = "";
  let activeTab = name;

  switch (name) {
    case "pipeline":
      html = viewPipeline();
      break;
    case "buildings":
      html = viewBuildings();
      break;
    case "deal":
      html = viewDeal(arg);
      activeTab = "";
      break;
    case "attention":
    default:
      html = viewAttention();
      activeTab = "attention";
      break;
  }

  app.innerHTML = html + tabs(activeTab);
  wireFilters();
  window.scrollTo(0, 0);
}

// Delegated navigation for anything with data-nav.
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav]");
  if (!el) return;
  e.preventDefault();
  location.hash = el.getAttribute("data-nav");
});

window.addEventListener("hashchange", render);

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function loadData() {
  const res = await fetch("../data/deal-stack.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load deal-stack.json (${res.status})`);
  const data = await res.json();
  DEALS = Array.isArray(data.deals) ? data.deals : [];
  META = data.meta || {};
}

async function boot() {
  await ensureAuth();
  try {
    await loadData();
  } catch (err) {
    document.getElementById("app").innerHTML = `
      <header class="top"><h1>Deal Engine</h1></header>
      <div class="empty">
        Could not load the deal stack.<br />${esc(err.message)}<br /><br />
        Serve this app over http, not file://. From the deal-engine folder run
        a static server and open /app/. See the README.
      </div>`;
    return;
  }

  if (!location.hash) location.hash = "#/attention";
  render();

  // Register the service worker for offline home-screen use.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

boot();
