# RTQ Review Content Web

Internal Next.js application for reviewing RTQ paper content directly from the
active `rtq-content` checkout. Unlike Review Markdown Web, this application does
not consume generated Markdown. Paper content is always read-only; review
outcomes use `review-api` and Google Sheets while comments remain machine-local.

The application currently provides collection and file browsing, full nested
paper presentation, five-axis runtime tag filters, independent question and
answer content-RAG filters, rendered and raw content views, allowlisted
canonical paper assets, Google Sheets outcome submission, and local append-only
review comments. A filter-aware left rail links directly to every visible
question, subquestion, and sub-subquestion. The read-only `allTopicsToml`
collection exposes the complete one-way projection across every active tag.

Authored `PaperList` wrappers render directly in question, answer, working,
formula, and tip Markdown. The optional `listStyleType` uses the shared review
contract and browser-native CSS markers; raw source retains the authored
wrapper. Unwrapped ordered and unordered lists default to `decimal` and `disc`.

The paper index also links to a dedicated read-only view of the canonical
`packages/papers/scripts/papers/lib/model/macros.toml`. That page treats the
file as one review document and shows every macro's source and rendered
expansion without paper review controls.

Its direct-TOML KaTeX macro path and current semantic-colour conformance are
recorded in the canonical
[RTQ KaTeX Semantic Colour Architecture](https://github.com/Read-The-Question/rtq-web/blob/develop/apps/web/docs/architecture/design-system/katex-semantic-colours.md).

## Requirements

- Node.js 24.19.0 and pnpm 10.15.1 from the workspace root
- A sibling `../rtq-content` checkout, or `RTQ_CONTENT_ROOT` set to a complete
  `rtq-content` Git root
- The local `review-api` service at `http://localhost:4567`, or
  `RTQ_REVIEW_API_BASE_URL` set to its server-only URL

`RTQ_REVIEWER` sets the short reviewer identity sent with outcomes and recorded
with comments; it defaults to `ap` and accepts letters, numbers, dots,
underscores, and hyphens.

## Local use

From the `rtq-review` workspace root:

```bash
pnpm review-content-web:dev
```

Open `http://localhost:3001`.

The paper index reads the current working tree on each refresh. A selected paper
uses a stable route shaped as `/papers/<collection>/<source-relative-path>`.

## Live source behavior

The index enumerates every supported collection on each request, so additions,
removals, and renames appear after a page refresh. It keeps only paper summaries
in a process-local cache and uses each file's filesystem fingerprint to reparse
changed metadata; unchanged paper bodies are not repeatedly parsed. The first
index request after a server restart rebuilds this disposable cache directly
from TOML. No generated Markdown or durable index is involved.

A paper route is dynamic and reads the selected TOML directly for every server
request. While a paper remains open, returning focus to the tab or making a
hidden tab visible checks only that selected file—there is no polling and no
corpus rescan. If its content hash changed, the current rendered view remains
available and a banner offers a controlled refresh. Temporarily invalid TOML,
deleted or moved files, and failed checks have separate retryable notices.

Development and production builds use the same behavior. In development, edit
the content checkout and return to the review tab to trigger the selected-file
check. In production, the Node.js process must be able to see the same local
checkout; each process maintains its own disposable index-summary cache.
Dimensional and RAG filtering operates entirely on the already loaded paper in
the browser and does not read TOML or contact Google Sheets.

## Review controls

- Combine tags within any of the five dimensions and filter question and answer
  content-RAG states independently. The shared URL preserves the complete
  filter scope across refreshes, along with the active matching question.
- Use **Clear all** to reset both state facets, all five tag dimensions, and the
  active question while retaining unrelated display parameters.
- Use the simple display switches to show or hide workings and answers,
  dimensional tags, raw TOML values, Question review, and Answer review. The
  review sides are independent, so answer-only and question-only layouts are
  supported. Display preferences stay in local browser storage and existing
  combined review-panel preferences migrate to the two switches.
- Use the persistent **Simple review** switch to choose between the two-action
  **Approved**/**Reset** controls and the advanced set of review outcomes.
  Approved submits `PRG`; Reset clears only the Google Sheets outcome cell and
  never removes SQLite feedback.
- Rendered workings follow the production RTQ hierarchy: formulas and tips use
  labelled rows, later methods have their own divider, and authored
  `WorkingSection` stages retain their titles and connected side rail. Hidden
  stages remain absent from the rendered view but are still inspectable through
  **Raw source**.
- Use **Show previous feedback** to reveal immutable feedback from RAG states
  other than the current state; it is off by default. Each feedback region
  reports current and previous counts even when history is hidden.
- Use the Previous/Next controls or `J`/`K` (`Alt` + arrow keys also work) to
  move through matching top-level question trees. The left question rail is
  built from that same filtered result and links to every displayed hierarchy
  level.
- All TOML and assets remain read-only. The asset route exposes only question
  images, manual working/answer images, and generated long-division SVGs.

## Review persistence

Question and answer outcomes are submitted to Google Sheets through the local
`review-api`; the UI labels successful submissions as such and keeps the new
outcome visible for the current browser session. Canonical TOML remains the
cross-reload outcome source after the existing Sheets synchronization runs. An
outcome reset is sent as an explicit empty RAG value after the usual Review API
identity, sheet, and content-state validation.

Comments never call `review-api`. They are appended through Drizzle to
`<rtq-review>/database/review-content.sqlite`. Every question, subquestion, and
sub-subquestion uses its own UUID for feedback; its own `rtq-question-id` is
retained only when present. Nested nodes inherit only the corresponding
question or answer RAG state from their containing top-level question.
Current-state comments appear against their exact node by default; **Show
previous feedback** also reveals earlier-state history. Feedback uses a
prominent full-width treatment below its stable Add Comment form, so appended
history does not move the composer farther down. All comments are read-only
after creation, with no edit, delete, or reset route. The main SQLite database
is versioned with this repository so feedback can be read from other machines;
its journal, WAL, and SHM sidecars remain ignored.

## Checks and production build

```bash
pnpm --filter rtq-review-content-web format:check
pnpm --filter rtq-review-content-web lint:check
pnpm --filter rtq-review-content-web types
pnpm --filter rtq-review-content-web test
pnpm --filter rtq-review-content-web database:tracking:check
pnpm --filter rtq-review-content-web build
```

With the dev server running, the representative live-content route smoke test
is available as:

```bash
pnpm --filter rtq-review-content-web test:browser
```

## Acceptance walkthrough

Use mocked Review API responses for this walkthrough; do not submit a test
outcome to the production Google Sheet.

1. Open one canonical paper and one derived paper, and confirm their raw values
   and allowlisted paper assets come directly from the content checkout.
2. Select tags in two dimensions, confirm the visible set is reduced using OR
   within each dimension and AND across dimensions, then add independent
   question and answer RAG-state filters.
3. Copy the filtered URL, refresh, and confirm the filter scope is restored.
   Use **Clear all**, then reopen the copied URL to prove clear and restore
   independently.
4. Submit a mocked question or answer outcome and confirm the success state is
   visible without changing the source TOML.
5. Append feedback to a question or nested question, refresh, and confirm it
   remains attached to that exact UUID at the current top-level RAG state.
6. Change the current state, confirm the earlier feedback is hidden, then turn
   on **Show previous feedback** and confirm the prior-state feedback appears
   in its original context.
