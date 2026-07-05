# deal-engine

Private deal-tracking system for Vince Strake, landlord leasing broker at
Partners Real Estate, Houston. It mirrors VTS but is meant to be fed
automatically from email. This is a personal tool. Only Vince sees it.

Plain Node, no database. `data/deal-stack.json` is the single source of truth.

## Layout

```
deal-engine/
  data/
    deal-stack.json     the deal stack, one record per active or dead deal
  scripts/
    validate.js         schema and health checks over the stack
  app/                  the front end (static PWA, no build step)
    index.html
    app.js              views, routing, rendering
    auth.js             optional password gate scaffold
    styles.css
    tokens.css          brand tokens, the file to swap
    manifest.webmanifest
    sw.js               service worker for offline home-screen use
    icons/icon.svg
  vercel.json           static deploy config
  middleware.js.example real password gate for Vercel (opt in)
  package.json
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
| `log`            | array of `{ date, event, source }`, source is email, manual, or system |
| `flags`          | free-form tags, for example `placeholder`                              |
| `encumbrances`   | known obstacles, for example a pending co-tenancy or percentage rent   |

Economic fields may be `null` when unknown. `ner` is net effective rent.
`round` is the current negotiation round.

## Validation

```bash
npm run validate
```

The validator checks:

1. Schema integrity. Required fields exist, types are right, and `stage`,
   `ball`, and `log[].source` use allowed values. Duplicate ids are caught.
2. Stale ownership. Any deal where `ball` is `us` for more than 3 days is
   flagged, so nothing sits on your desk unattended.
3. Expired clocks. Any `clock.due` in the past on a live deal is flagged.
4. Stage and log drift. The log should not be empty past inquiry, log dates
   must be chronological, terminal stages must be recorded in the log, and
   `ball_since` should not predate the first log entry.

Schema problems are errors and exit non-zero, so `npm run validate` can gate a
commit or a scheduled run. Stale balls, expired clocks, and drift are warnings
and do not fail the run.

## Front end

A single-page PWA in `app/` that reads `data/deal-stack.json` directly. No
framework, no bundler, no build server. Plain HTML, CSS, and ES modules.
Mobile-first, dark-mode aware, and installable to the iPhone home screen.

Four views:

1. Attention (the default on open). Every deal where the ball is in your
   court, sorted by clock urgency, most overdue first. This is the "what do
   I touch today" screen.
2. Pipeline. A VTS-style funnel from Inquiry through Executed with the deal
   count and total SF per stage, filterable by building and owner, with the
   matching deals listed underneath.
3. Buildings. A vertical stacking diagram per building, one block per tracked
   suite, colored by status (leased, in proposal, in legal, touring, vacant),
   with an encumbrance warning icon on affected suites. Tap a suite to open
   its deal.
4. Deal detail. Tenant, RSF, suite, brokers, full economics with NER,
   ball-in-court with days elapsed, clock countdown, the full dated activity
   log with source citations, and the linked documents folder plus email
   thread fingerprints.

The stacking diagram is built from the deals in the stack, so it shows the
suites you are tracking, not a full rent roll. Add building inventory to the
schema later if you want vacant and existing-lease floors to appear too.

### Running it locally

The app fetches the JSON over http, so it needs a static server. It will not
work from a `file://` path. From the `deal-engine` folder:

```bash
npx http-server -p 8080 -c-1 .
# then open http://localhost:8080/app/
```

Any static server works (`python3 -m http.server 8080` and open
`/app/index.html` is fine too).

### Brand tokens

There was no `~/Partners/brand/` tokens file when this was built, so
`app/tokens.css` ships the Partners palette as placeholders. Swap the values
in that one file and the whole app follows. Nothing else references colors
directly.

### Deploying to Vercel

The whole `deal-engine` folder deploys as a static site with one command, no
build step:

```bash
cd deal-engine
vercel deploy --prod
```

`vercel.json` redirects the root to the app and serves the data file with a
no-store cache header so you always see the current stack. The service worker
keeps the last-known stack available offline once the app has been opened.

### Password gate for a deployment

Local use has no login. For a Vercel deployment you have two options, both
documented in `app/auth.js`:

1. Real protection: use Vercel Deployment Protection (password protection in
   project settings), or rename `middleware.js.example` to `middleware.js`
   and set a `GATE_PASSWORD` env var. This runs on the server before any file
   is served, so it actually protects the JSON.
2. Convenience gate: flip `AUTH_ENABLED` in `app/auth.js`. This only hides the
   UI and is not real security on its own.

## Seed data

The stack ships with five placeholder deals, one per building, each tagged
`placeholder`: San Felipe Plaza (Sovereign), Jones on Main (Wideman),
15600 JFK (Ladder), Bayou Place (Cordish), and 1415 Louisiana (WEDGE).
Replace them with real data as deals come in.
