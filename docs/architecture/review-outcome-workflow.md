# Review outcome workflow

Status: living architecture, updated 10 September 2026.

This document describes how Review Content Web records review decisions and how
those decisions later change canonical paper TOML. It is intentionally a living
document: the database-backed path is implemented, but its cutover task remains
open while the workflow is reviewed and refined.

The central rule is that a review decision and a content-state transition are
two separate events. The review website records a state-scoped decision. A
later, operator-controlled sync in `rtq-content` decides whether that decision
still applies to the current canonical state and, if it does, updates TOML.

## Ownership and sources of truth

| Concern                                              | Owner                                | Source of truth                                                                                                           |
| ---------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Current question and answer state                    | `rtq-content/packages/papers`        | Complete papers under `papers/toml`                                                                                       |
| RAG vocabulary and transition policy                 | `rtq-content/packages/papers`        | `docs/architecture/rag-states.md`, `scripts/papers/lib/reader/rag_reader.rb`, and `scripts/papers/lib/rag_review_sync.rb` |
| Review comments and database outcomes                | `rtq-review/packages/review-store`   | `database/review-content.sqlite` through `@rtq/review-store/server`                                                       |
| Reviewer interaction and live-target validation      | `rtq-review/apps/review-content-web` | The current canonical paper read from the active `rtq-content` checkout                                                   |
| Outcome resolution across repositories               | `rtq-review/packages/review-store`   | The versioned `review-outcomes:resolve` standard-input/standard-output contract                                           |
| TOML inventory, transition calculation, and mutation | `rtq-content/packages/papers`        | `scripts/papers/lib/database_review_sync.rb` and the shared RAG transition engine                                         |

Review Content Web never owns or edits canonical content state. Review Store
does not maintain a mirror of current state and does not decide the successor
state. The content sync does not open SQLite or import Drizzle internals.

## End-to-end flow

```text
Reviewer opens a canonical question
  -> Review Content Web reads its UUID and current question/answer RAG states
  -> reviewer submits an outcome for one side
  -> the server re-reads canonical TOML and rejects a stale target
  -> exactly one configured destination stores the review decision
  -> canonical TOML remains unchanged

Operator runs the database-outcome sync in rtq-content
  -> sync inventories every top-level UUID and both current side states
  -> review-store resolves only exact UUID + side + state matches
  -> rtq-content applies the current transition policy
  -> dry-run reports, or apply edits, only canonical RAG state fields
  -> stored review outcomes remain unchanged
```

### 1. Open the review page

Review Content Web reads the selected complete paper directly from canonical
`papers/toml`. For each top-level question, the question and answer are
independent review targets. Each target has:

- the question UUID;
- a side: `question` or `answer`;
- the current canonical RAG value for that side.

In database mode, the page also requests stored outcomes for those exact
targets. An outcome recorded for the same UUID and side at an earlier state is
not displayed as the current decision.

### 2. Submit a review request

Review Content Web uses descriptive actions while retaining the canonical code
as an internal request value:

| Reviewer-facing action | Internal value | Content transition after sync |
| ---------------------- | -------------- | ----------------------------- |
| Approved               | `PRG`          | Advance to the next state     |
| Change Requested       | `PRCR`         | No change                     |
| Change Complete        | `PRCC`         | No change                     |
| Marked Blocked         | `PRBD`         | Move to Blocked               |
| Coming Soon            | `PRCS`         | Move to Coming Soon           |
| Reset                  | no value       | No change                     |

Simple mode exposes Approved, Change Requested, and Reset. Detailed mode adds
the other three canonical actions. Reset clears the request for the exact
state-scoped target and returns it to the missing/`PRNS` default
representation; `PRNS` is not submitted as another transition trigger.

Review Content Web, Review Markdown Web, and Review API all reject retired
outcomes at their request boundaries. The generated Markdown controls use the
same five actionable values and provide Reset separately.

Before writing anything, the server resolves the submitted paper and UUID from
the active content checkout again. It compares the submitted side and RAG state
with live canonical TOML. A page that became stale cannot record an outcome for
the old state; the route rejects it and the reviewer must reload.

### 3. Store the outcome in one destination

`RTQ_REVIEW_OUTCOME_DESTINATION` selects the writer:

| Value           | Behaviour                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `database`      | Store or clear the outcome through the shared Review Store package. This is the default.                            |
| `google-sheets` | Forward the existing request to Review API and Google Sheets. This is the retained compatibility and rollback path. |

The branches are exclusive. A request never writes to both destinations, and a
database failure does not fall back to Google Sheets. An unsupported setting is
a configuration error.

In database mode, one `review_outcomes` row represents the latest decision for
one state-scoped target:

| Field        | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `rtq_uuid`   | Canonical top-level question identity            |
| `side`       | `question` or `answer`                           |
| `rag_state`  | Canonical state in which the review occurred     |
| `outcome`    | Review decision such as `PRG`                    |
| `reviewer`   | Reviewer identity supplied by the application    |
| `created_at` | Time this state-scoped decision was first stored |
| `updated_at` | Time it was last replaced                        |

The unique identity is `rtq_uuid + side + rag_state`. Submitting another
decision for that identity replaces the outcome and reviewer while retaining
the original creation time. Reset deletes only that exact outcome. It does not
delete comments.

The row deliberately does not store a paper path, a mirror of current
canonical state, a calculated next state, or an applied/consumed flag.

### 4. Leave canonical TOML unchanged until sync

Approval is a recorded instruction, not an immediate mutation. After the
review request succeeds, the TOML question or answer remains in its original
state. This pull boundary keeps canonical edits visible, reviewable, and under
the operator's control.

### 5. Resolve only currently applicable outcomes

From `rtq-content/packages/papers`, the database sync first parses every
complete canonical paper. It validates unique top-level UUIDs and recognised
question and answer states before asking Review Store for anything.

It sends all current targets to this command in the sibling `rtq-review`
workspace:

```sh
pnpm --silent review-outcomes:resolve
```

The versioned JSON request contains only UUID, side, and current RAG state. The
resolver performs one indexed batch lookup and returns only exact matches. It
does not return the growing comment history or irrelevant outcomes from other
states, and it performs no transition or write.

### 6. Calculate and apply the transition in `rtq-content`

The sync passes each matching outcome and current state to the same canonical
RAG workflow used by the existing review sync. The transition ladder is not
copied into this document; consult the current sources listed in the ownership
table before changing its behaviour.

Preview the complete plan:

```sh
pnpm papers:review-outcomes:sync
```

Apply the reported plan:

```sh
pnpm papers:review-outcomes:sync:apply
```

Dry-run is the default. Apply mode uses the line-preserving TOML updater and
changes only the matching `rtq-question-rag` or `rtq-answer-rag` field. It does
not update the companion review-outcome/comment fields, derived TOML, generated
Markdown, PDFs, assets, Google Sheets, or the review database.

## Replay and failure behaviour

The design does not need an “applied” database flag:

- If a run stops before a TOML edit, canonical state still matches the stored
  outcome, so the next run proposes it again.
- If a TOML edit was made but later discarded, the restored state matches and
  the outcome becomes applicable again.
- If a TOML edit remains, that side is now at its successor state. The earlier
  outcome no longer matches, so another sync does nothing unless a separate
  outcome exists for the successor state.
- A single sync calculates at most one transition for the state it observed;
  it does not cascade through outcomes stored for several future states.
- Inventory, resolver, contract, or transition errors fail the run rather than
  silently skipping questionable data. The complete plan is built before apply
  mode edits any file.

For example, a question at `rag_wf_ng2` with a `PRG` stored for
`rag_wf_ng2` advances according to the current transition engine. On the next
run the same stored row is inert because the canonical question no longer has
that reviewed state. Restoring the TOML question to `rag_wf_ng2` makes the row
applicable again.

## Comments are separate review facts

Comments and outcomes intentionally use different storage semantics:

- comments are append-only and may have many rows for one UUID, side, and
  state;
- outcomes are replaceable and have at most one row for one UUID, side, and
  state;
- current-state comments are shown by default;
- comments from prior states remain available through **Show previous
  feedback**;
- advancing or resetting an outcome never removes comment history.

Nested question nodes can have their own comment identity and inherit the
containing top-level side state. Outcome submission and canonical sync remain
limited to the top-level review targets currently supported by Review Content
Web.

## Database ownership and migrations

`@rtq/review-store` is the only owner of the Drizzle schema, migration journal,
SQLite connection, database-path resolution, and persistence queries. Runtime
applications use its high-level server APIs. Cross-repository callers use the
resolver command rather than importing the database layer.

From the `rtq-review` root:

```sh
pnpm database:migrate
pnpm database:tracking:check
```

Drizzle records applied migrations in its migration table inside the SQLite
database. Running the migration command again applies only migrations that are
not already recorded.

## Current verification

The implementation has focused tests for state and side isolation, replacement
and Reset, stale review submissions, exclusive destination selection,
current-state resolution, replay after canonical reset, and one-stage-per-sync
behaviour.

On 9 September 2026, the live canonical dry-run completed successfully across
12,548 question/answer targets. The database contained no exact matching
outcomes, so it proposed zero transitions and changed zero files.

## Known gaps and future refinements

This is the initial architecture record, not the final operational runbook.
Keep the Review Content Web cutover task open while the review flow is assessed.
Record newly identified behavioural gaps and decisions here before changing the
implementation. The later operations task will add the final cutover, rollback,
inspection, dashboard-refresh, troubleshooting, and validation procedure once
the workflow is accepted.
