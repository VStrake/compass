"use strict";

/*
 * Tests for the sweep engine. Run: npm test  (node --test)
 *
 * These drive the pure runSweep() with small fixtures that use real broker
 * names so the terse register phrasing is exercised end to end. No disk IO.
 */

const test = require("node:test");
const assert = require("node:assert");
const { runSweep } = require("./sweep");

function baseDeal(over) {
  return Object.assign(
    {
      id: "d1",
      building: "San Felipe Plaza",
      owner: "Sovereign",
      tenant: "Acme Corp",
      tenant_type: "law firm",
      rsf: 12500,
      floor_suite: "18th floor, Suite 1800",
      stage: "proposal_out",
      ball: "tenant",
      ball_since: "2026-07-01",
      clock: { type: "x", due: "2026-07-10", what: "y" },
      next_action: "n",
      economics: { rate_nnn: 42, term_mo: 84, free_rent_mo: 6, ti: 65, ner: 34.5, round: 1 },
      people: { tenant_broker: "Jordan Kim, Savills", ll_counsel: "House", owner_contact: "Sov" },
      folder_path: "p",
      thread_subjects: ["San Felipe Plaza Suite 1800 proposal"],
      log: [],
      flags: [],
      encumbrances: [],
    },
    over || {}
  );
}

const OURS = "vince.strake@partnersrealestate.com";

test("outbound LLP1 goes out to the tenant rep, ball flips to tenant", () => {
  const email = {
    id: "M1",
    from: OURS,
    to: "jordan.kim@savills.com",
    subject: "San Felipe Plaza Suite 1800 proposal",
    date: "2026-07-06",
    bodyPreview: "Please find attached our proposal.",
    attachments: ["SFP-LLP1.pdf"],
  };
  const { updatedDeals, changes } = runSweep([baseDeal()], [email]);
  assert.equal(changes.length, 1);
  const d = updatedDeals[0];
  assert.equal(d.ball, "tenant");
  const last = d.log[d.log.length - 1];
  assert.equal(last.event, "LLP1 sent to Savills.");
  assert.equal(last.source, "email");
  assert.equal(last.source_id, "M1"); // cites its source
});

test("inbound counter lands on our desk and stages a draft", () => {
  const email = {
    id: "M2",
    from: "jordan.kim@savills.com",
    to: OURS,
    subject: "RE: San Felipe Plaza Suite 1800 proposal",
    date: "2026-07-06",
    bodyPreview: "Our counter attached.",
    attachments: ["counter-1800.pdf"],
  };
  const { updatedDeals, changes, drafts } = runSweep([baseDeal()], [email]);
  assert.equal(changes.length, 1);
  const d = updatedDeals[0];
  assert.equal(d.stage, "negotiating");
  assert.equal(d.ball, "us");
  assert.equal(d.ball_since, "2026-07-06");
  assert.equal(d.log[d.log.length - 1].event, "Counter received from Savills.");
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].to, "Savills");
});

test("fully executed email closes the deal", () => {
  const email = {
    id: "M3",
    from: "counsel@sovereign.com",
    to: OURS,
    subject: "RE: San Felipe Plaza Suite 1800 proposal",
    date: "2026-07-08",
    bodyPreview: "Lease is fully executed by both parties.",
    attachments: ["executed.pdf"],
  };
  const { updatedDeals } = runSweep([baseDeal({ stage: "lease_out" })], [email]);
  assert.equal(updatedDeals[0].stage, "executed");
  assert.equal(updatedDeals[0].log[0].event, "Lease fully executed.");
});

test("VTS notification folds in with teammate credit and vts source", () => {
  const email = {
    id: "M4",
    from: "no-reply@viewthespace.com",
    to: OURS,
    subject: "Tour activity: San Felipe Plaza Suite 1800",
    date: "2026-07-06",
    bodyPreview: "A tour of Suite 1800 was logged by Marcus Reed.",
    attachments: [],
  };
  const { updatedDeals, changes } = runSweep([baseDeal()], [email]);
  assert.equal(changes.length, 1);
  const last = updatedDeals[0].log[0];
  assert.equal(last.source, "vts");
  assert.match(last.event, /VTS:/);
  assert.match(last.event, /Marcus Reed/);
});

test("low confidence never guesses, deal untouched", () => {
  const email = {
    id: "M5",
    from: "stranger@nowhere.com",
    to: OURS,
    subject: "Quick question",
    date: "2026-07-06",
    bodyPreview: "Free for a call?",
    attachments: [],
  };
  const { updatedDeals, changes, questions } = runSweep([baseDeal()], [email]);
  assert.equal(changes.length, 0);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].type, "low_confidence");
  assert.deepEqual(updatedDeals[0].log, []); // untouched
});

test("new-deal-looking email becomes a candidate, not a deal", () => {
  const email = {
    id: "M6",
    from: "broker@leaseco.com",
    to: OURS,
    subject: "New requirement 20,000 SF downtown",
    date: "2026-07-06",
    bodyPreview: "Client has a requirement for 20,000 SF, new prospect, seeking options.",
    attachments: [],
  };
  const { updatedDeals, questions } = runSweep([baseDeal()], [email]);
  assert.equal(updatedDeals.length, 1); // no deal created
  assert.equal(questions.length, 1);
  assert.equal(questions[0].type, "new_deal_candidate");
});

test("never deletes a deal and every applied log entry cites a source", () => {
  const emails = [
    {
      id: "M7",
      from: "jordan.kim@savills.com",
      to: OURS,
      subject: "RE: San Felipe Plaza Suite 1800 proposal",
      date: "2026-07-06",
      bodyPreview: "counter attached",
      attachments: ["counter.pdf"],
    },
  ];
  const { updatedDeals } = runSweep([baseDeal(), baseDeal({ id: "d2" })], emails);
  assert.equal(updatedDeals.length, 2);
  for (const d of updatedDeals) {
    for (const l of d.log) {
      assert.ok(l.source_id, "log entry must cite a source_id");
    }
  }
});

test("emails process oldest first so rounds compound", () => {
  const emails = [
    {
      id: "B",
      from: "jordan.kim@savills.com",
      to: OURS,
      subject: "RE: San Felipe Plaza Suite 1800 proposal",
      date: "2026-07-08",
      bodyPreview: "second counter",
      attachments: ["counter2.pdf"],
    },
    {
      id: "A",
      from: OURS,
      to: "jordan.kim@savills.com",
      subject: "San Felipe Plaza Suite 1800 proposal",
      date: "2026-07-06",
      bodyPreview: "llp",
      attachments: ["LLP1.pdf"],
    },
  ];
  const { updatedDeals } = runSweep([baseDeal()], emails);
  const log = updatedDeals[0].log;
  assert.equal(log[0].source_id, "A"); // older first
  assert.equal(log[1].source_id, "B");
});
