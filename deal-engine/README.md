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

## Seed data

The stack ships with five placeholder deals, one per building, each tagged
`placeholder`: San Felipe Plaza (Sovereign), Jones on Main (Wideman),
15600 JFK (Ladder), Bayou Place (Cordish), and 1415 Louisiana (WEDGE).
Replace them with real data as deals come in.
