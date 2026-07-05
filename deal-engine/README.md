# deal-engine

Private deal-tracking system for Vince Strake, landlord leasing broker at
Partners Real Estate, Houston. It mirrors VTS but is fed automatically from
email. This is a personal tool. Only Vince sees it.

Plain Node, no database. `data/deal-stack.json` is the single source of truth.
The automated pipeline runs in Claude Cowork on a schedule; this README is how
to run every piece by hand when Cowork is down.

## Command reference

```bash
npm run validate      # schema + health checks on the stack
npm run sweep         # fold sweep/inbox-batch.json into the stack (snapshots first)
npm run generate:sfp  # write the San Felipe Plaza workbook to exports/
npm run audit         # check the newest workbook against the stack
npm run snapshot      # take a manual restore point
npm test              # run the sweep engine tests
npm run serve         # static server for the app at /app/
```

## Manual runbook (Cowork is down)

Do these in order. The automated version is documented in
`HANDOFF-COWORK.md`; this is the same pipeline by hand.

### 1. Build the inbox batch

The sweep reads `sweep/inbox-batch.json`, an array of emails. When Cowork is
down, build it by hand from Outlook. One object per email:

```json
{
  "id": "<outlook message id>",
  "from": "sender@firm.com",
  "to": "vince.strake@partnersrealestate.com",
  "subject": "RE: San Felipe Plaza Suite 1800 proposal",
  "date": "2026-07-06",
  "bodyPreview": "first few hundred chars of the body",
  "attachments": ["SFP-1800-counter-v2.pdf"]
}
```

`id` must be the real message id (it becomes the citation in the log).
Attachment file names matter: LLP, counter, and redline drive classification.
A worked sample batch ships in `sweep/inbox-batch.json`.

### 2. Run the sweep, then validate

```bash
npm run sweep
npm run validate
```

The sweep snapshots the stack to `archive/` first, then updates
`data/deal-stack.json` and writes `sweep/summary.md` (what changed, what needs
you, drafts to stage) and `sweep/questions.json` (anything it would not guess).
Read `summary.md`. If validate reports errors, fix them before going further.

Preview without writing anything:

```bash
node sweep/sweep.js --dry-run
```

### 3. Regenerate the workbook, then audit

```bash
npm run generate:sfp
npm run audit
```

The workbook lands in `exports/` as
`SFP - Master + Activity Stack_M.D.YY.xlsx`. Audit must say "In sync".

### 4. Publish and file by hand

- Upload the workbook from `exports/` to the SharePoint folder
  "Activity Stacks for Stephan". Keep the filename as generated.
- Save each email's attachments into that deal's `folder_path`.

### 5. Drafts and comments

- For each item under "Drafts to stage" in `summary.md`, write an Outlook
  draft to the counterparty in Vince's register. Leave it in Drafts. Never
  send. Vince is the only sender.
- For deals with `source: "vts"` log entries this run, post the one-line VTS
  comment through the browser, spaced across business hours.

### 6. Handle questions

Open `sweep/questions.json`. Low-confidence and ambiguous items need Vince to
say which deal. New-deal candidates need Vince to decide whether to create a
deal. Nothing here changes the stack automatically.

### Undo a bad run

```bash
node scripts/snapshot.js --list          # newest first
cp archive/deal-stack.<stamp>_presweep.json data/deal-stack.json
```

## The stack

`data/deal-stack.json` holds a `meta` block and a `deals` array. Each deal:

| field            | meaning                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `id`             | stable slug, unique across the stack                                     |
| `building`       | building name                                                           |
| `owner`          | ownership entity                                                        |
| `tenant`         | prospective tenant                                                      |
| `tenant_type`    | tenant industry or use                                                  |
| `rsf`            | rentable square feet                                                    |
| `floor_suite`    | floor and suite                                                         |
| `stage`          | inquiry, touring, proposal_out, negotiating, loi_agreed, legal, lease_out, executed, dead |
| `ball`           | whose court it is: us, tenant, attorney, owner                          |
| `ball_since`     | date the ball landed in that court (YYYY-MM-DD)                         |
| `clock`          | `{ type, due, what }`, the next hard deadline                          |
| `next_action`    | the single next thing to do                                             |
| `economics`      | `{ rate_nnn, term_mo, free_rent_mo, ti, ner, round }`                  |
| `people`         | `{ tenant_broker, ll_counsel, owner_contact }`                         |
| `folder_path`    | where the deal documents live on disk                                  |
| `thread_subjects`| email subject fingerprints used to match incoming mail to this deal    |
| `log`            | array of `{ date, event, source, source_id? }`                        |
| `flags`          | free-form tags, for example `placeholder`                              |
| `encumbrances`   | known obstacles, for example a pending co-tenancy or percentage rent   |

Economic fields may be `null` when unknown. `ner` is net effective rent.
`round` is the current negotiation round. Log `source` is one of email,
manual, system, or vts; `source_id` is the citation (the email id) and is
present on every entry the sweep writes.

## Validation

```bash
npm run validate
```

Checks schema integrity (types, allowed values, duplicate ids), deals where
`ball` is `us` for more than 3 days, expired clocks on live deals, and stage or
log drift. Schema problems are errors and exit non-zero. The health items are
warnings.

## Front end

A single-page PWA in `app/` that reads `data/deal-stack.json`. No framework, no
build step. Mobile-first, dark-mode aware, installable to the iPhone home
screen. Four views: Attention (default, ball in your court by clock urgency),
Pipeline (VTS-style funnel, filterable by building and owner), Buildings
(stacking diagram with status colors and encumbrance warnings), and Deal detail
(economics with NER, clock countdown, dated log with source citations, linked
documents).

Run it locally (it fetches JSON over http, so it needs a server):

```bash
npm run serve
# then open http://localhost:8080/app/
```

Brand tokens live in `app/tokens.css`. There was no `~/Partners/brand/` file
when this was built, so it ships the Partners palette as placeholders. Swap
that one file to rebrand.

## Generators

`generators/sfp-activity-stack.js` reads the stack and writes the San Felipe
Plaza Master Activity Stack workbook (four tabs: Activity Report grouped by
stage, Stacking Diagram, Deal Activity List, Vacancy Conditions). The shared
core is `generators/lib/activity-stack-core.js`; a new building is a new config
block that reuses it (Jones on Main next).

Note: this was built without the reference workbook. Calibrate column widths,
fills, and header wording in `activity-stack-core.js` against the real
`SFP-Master-Activity-Stack-reference.xlsx` when it is available. Add a `floors`
inventory in the building config to render every floor in the stacking and
vacancy tabs, not just tracked suites.

## Deploy the app to Vercel (private, password protected)

Vercel projects are private to your account by default. These commands add a
server-side password gate on top, so anyone with the URL still needs the
password. The gate is an Edge Middleware that runs before any file is served,
including the JSON.

```bash
cd deal-engine
mv middleware.js.example middleware.js      # activate the gate
npm i -g vercel
vercel login
vercel link                                  # create/link the project
vercel env add GATE_PASSWORD production       # paste a strong password
vercel env add GATE_PASSWORD preview          # same password for previews
vercel deploy --prod
```

The browser will prompt for a password (Basic Auth) on every visit. To change
it later, `vercel env rm GATE_PASSWORD production` then add it again and
redeploy. If you are on a Vercel plan with built-in Password Protection you can
use that instead (Project Settings, Deployment Protection) and skip the
middleware; leave `middleware.js.example` as-is in that case.

Add the deployed URL to your iPhone home screen (Share, Add to Home Screen) to
install the PWA.

## Project layout

```
deal-engine/
  data/deal-stack.json          source of truth
  app/                          static PWA (see Front end)
  generators/
    lib/activity-stack-core.js  reusable workbook core
    sfp-activity-stack.js       San Felipe Plaza generator
  sweep/
    sweep.js                    email -> stack engine
    lib/                        match, classify, apply
    sweep.test.js               tests
    inbox-batch.json            sample input batch
  scripts/
    validate.js                 schema + health checks
    snapshot.js                 versioning / undo
    audit.js                    workbook vs stack cross-check
  archive/                      snapshots (generated, gitignored)
  exports/                      generated workbooks (gitignored)
  vercel.json                   static deploy config
  middleware.js.example         optional Vercel password gate
  HANDOFF-COWORK.md             ops brief for the scheduled task
```

## Conventions

- No em dashes anywhere, in copy, comments, or generated text.
- Log and comment phrasing is Vince's terse register:
  `07/01/26 - LLP1 sent to Savills.`
- All outbound email is draft-only. Vince is the only sender.
- Snapshot before every write to the stack.

## Seed data

The stack ships with five placeholder deals, one per building, each tagged
`placeholder`: San Felipe Plaza (Sovereign), Jones on Main (Wideman),
15600 JFK (Ladder), Bayou Place (Cordish), and 1415 Louisiana (WEDGE).
Replace them with real data as deals come in.
