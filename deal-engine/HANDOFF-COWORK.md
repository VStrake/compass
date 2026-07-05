# HANDOFF: Cowork scheduled task operations brief

This is the operating manual for the Claude Cowork scheduled task that keeps
the deal stack current and produces the team workbooks. Read it top to bottom
before the first run. The golden rules are at the end. When in doubt, stop and
leave a question for Vince. Never send email. Never delete a deal.

Owner: Vince Strake (vince.strake@partnersrealestate.com), landlord leasing
broker, Partners Real Estate, Houston. This system is private to Vince.

## What this task does, in order

1. Fetch new mail into `sweep/inbox-batch.json`.
2. Run the sweep to update `data/deal-stack.json`.
3. Regenerate the building workbooks.
4. Save each workbook to the SharePoint folder "Activity Stacks for Stephan".
5. File email attachments into each deal's `folder_path`.
6. Stage outbound drafts in Outlook (draft-only, never send).
7. Post VTS comments through the browser, scattered across business hours.
8. Surface anything in `questions.json` to Vince and stop there.

Each step below says what to run, what it reads, and what it writes.

## Cadence

Run on business days, mid-morning and mid-afternoon (for example 9:30am and
2:30pm Central). Do not run overnight. Each run is idempotent on the mail it
has already folded in, because every applied log entry cites its source email
id and the sweep only advances stages forward.

## Step 1: Fetch mail into inbox-batch.json

Use the Outlook connector (Microsoft 365 / Partners Outlook MCP). Pull
messages received since the last successful run from Vince's inbox and the
relevant subfolders. For each message, write one object into the array at
`sweep/inbox-batch.json` with exactly this shape:

```json
{
  "id": "<outlook message id>",
  "from": "sender@firm.com",
  "to": "vince.strake@partnersrealestate.com",
  "subject": "RE: San Felipe Plaza Suite 1800 proposal",
  "date": "2026-07-06",
  "bodyPreview": "first ~500 chars of the body, plain text",
  "attachments": ["SFP-1800-counter-v2.pdf"]
}
```

Rules for this step:

- `id` must be the real Outlook message id. It becomes the citation in the
  activity log, so it has to round-trip back to the source email.
- `date` is `YYYY-MM-DD` (the received date).
- `attachments` is an array of file names only. The names matter: the
  classifier keys off LLP, counter, and redline in them.
- Include sent items too when they are proposals going out. The sweep tells an
  outbound LLP from an inbound counter by the sender domain
  (partnersrealestate.com is "us").
- Overwrite `inbox-batch.json` each run. It is a scratch input, not a log.

## Step 2: Run the sweep

```bash
npm run sweep
```

This snapshots `data/deal-stack.json` into `archive/` first (the undo point),
then matches, classifies, and applies each email, and writes three outputs:

- `data/deal-stack.json`  updated stack (source of truth)
- `sweep/questions.json`  low-confidence matches and new-deal candidates
- `sweep/summary.md`      what changed, what needs Vince, drafts to stage

Then confirm integrity:

```bash
npm run validate
```

If validate reports errors (not warnings), stop. Do not proceed to publish a
workbook built on a broken stack. Leave the summary and the validate output
for Vince.

The sweep never invents deals and never guesses. Anything it is unsure about
is in `questions.json`, not in the stack.

## Step 3: Regenerate the workbooks

```bash
npm run generate:sfp
# Jones on Main control book lands here as: npm run generate:jom
```

Each writes to `exports/` with the team filename pattern, for example
`SFP - Master + Activity Stack_7.5.26.xlsx`. Then sanity check the workbook
against the stack:

```bash
npm run audit
```

Audit compares the newest workbook to the JSON and must report "In sync". If
it lists divergences, regenerate and audit again before publishing.

## Step 4: Save the workbook to SharePoint

Upload each `exports/*.xlsx` to the SharePoint folder named
**"Activity Stacks for Stephan"** (find it with the SharePoint search tools on
the Microsoft 365 connector, then upload into that folder).

- Keep the exact generated filename. The date in the name is how Stephan finds
  the latest one.
- If a file with the same name already exists (a second run the same day),
  overwrite it. Same day, same name, newest content wins.
- Do not rename, reformat, or "clean up" the workbook. It is meant to look
  hand-made and consistent with prior weeks.

## Step 5: File attachments per folder_path

For every email the sweep applied that carried attachments, save those
attachments into that deal's `folder_path` (see the deal record in
`data/deal-stack.json`). Download via the Outlook connector using the message
id, then place the file in the deal folder.

- One deal folder per deal, at its `folder_path`.
- Keep original file names. Do not overwrite an existing different file; if a
  name collides, append the email date, for example
  `counter-1800 (2026-07-06).pdf`.
- Only file attachments for emails that matched a deal with confidence at or
  above threshold. Attachments on questioned emails wait for Vince's ruling.

## Step 6: Stage outbound drafts (draft-only)

`sweep/summary.md` lists the drafts to stage under "Drafts to stage". For each
one, create an Outlook **draft** addressed to the counterparty. Use the
Partners Outlook MCP prepare/confirm batch flow to create drafts.

- Every message is a DRAFT. Never send. Vince is the only sender, always.
- Match Vince's register: short, declarative, no filler. See the voice guide
  below. Reference the building and suite. Keep it to a few sentences.
- Attach the relevant document from the deal folder when the draft is a
  proposal or a turn of comments.
- Leave the draft in Vince's Drafts folder. Do not add it to a send queue, do
  not schedule it, do not auto-send under any condition.

Example draft body for "Counter received, respond" on San Felipe 1800:

> Jordan, got the counter on 1800. Reviewing with ownership now. Will come
> back to you by Thursday with our position on free rent and TI.

## Step 7: Post VTS comments through the browser

For deals with recent VTS activity folded in this run (log entries with
`source: "vts"`), post the matching short comment in VTS through the browser.

- Timing: scatter the posts across business hours. Do not post them all in one
  burst. Space them out by irregular gaps (for example 20 to 90 minutes apart)
  so the activity reads like a person working through the day, not a batch job.
  Never post outside roughly 8am to 6pm Central.
- Voice: Vince's short declarative register. One line. Past tense, factual.
  Examples:
  - "Sent LLP2 to Savills."
  - "Counter in from tenant. Reviewing with ownership."
  - "Tour done. Strong interest in the 18th floor."
- Post only what actually happened per the log. Do not editorialize, do not
  add next steps, do not tag anyone unless Vince's prior comments did.
- Credit teammates where the VTS entry names them. If the log says
  "(credit Marcus Reed)", the tour was Marcus's; the comment should reflect
  that it was his tour, not Vince's.

## Step 8: Surface questions, then stop

Open `sweep/questions.json`. For each item:

- `low_confidence` and `ambiguous_match`: do not touch the stack. Summarize for
  Vince (subject, from, best guess) and ask which deal it belongs to.
- `new_deal_candidate`: do not create a deal. Summarize it as a possible new
  requirement for Vince to confirm. Only Vince turns a candidate into a deal.

Post the run's `summary.md` where Vince will see it, with the questions called
out at the top. That is the end of the run.

## Voice guide (Vince's register)

Short. Declarative. Factual. Broker shorthand. No hedging, no pleasantries
padding the middle. Dates as MM/DD/YY. Examples of the log and comment style
the whole system uses:

- "07/01/26 - LLP1 sent to Savills."
- "07/03/26 - Counter received from Savills."
- "07/08/26 - Owner approval cleared."
- "07/12/26 - Tour done. Interest in high floors."
- "07/15/26 - Lease fully executed."

Drafts can be one to three sentences but keep the same plainspoken tone.

## Golden rules

1. All outbound email is draft-only. Vince is the only sender. No exceptions.
2. Never delete a deal. The sweep only patches fields and appends log entries.
3. Below the confidence threshold, ask. Never guess a match.
4. New-deal-looking mail is a candidate for Vince, never an auto-created deal.
5. Every log entry cites its source email id. If it cannot cite a source, it
   does not go in the log.
6. Snapshot before every write. `npm run sweep` does this for you; do not
   bypass it by editing `data/deal-stack.json` directly.
7. If `npm run validate` reports errors, stop and hand off to Vince.
8. This system is private to Vince. Do not share workbooks, drafts, or stack
   data with anyone except by saving the workbook to the designated SharePoint
   folder.

## Failure handling

- Outlook fetch fails: skip the run, leave a note, retry next cadence. Do not
  run the sweep on a stale or empty batch and publish a workbook from it.
- Sweep or validate errors: stop after Step 2. Do not publish.
- SharePoint upload fails: keep the workbook in `exports/`, note the failure,
  retry next run. The stack is already correct; only publishing is behind.
- Restore point: to undo a bad run, copy the latest file from `archive/` back
  to `data/deal-stack.json` (`node scripts/snapshot.js --list` shows them).
