# `@rtq/review-store`

Server-only persistence for review comments, review outcomes, and product-wide
review findings. Runtime code must use the high-level `comments`, `outcomes`,
and `findings` repositories exported from
`@rtq/review-store/server`; schema, SQLite, migration, and database-path modules
are package internals. The package deliberately has no default export path, so
runtime consumers must opt into the explicit server entry point.

The `./types` export contains type-only identity and record contracts for code
that does not need database access. Do not import the package root into client
components.

The canonical database remains `rtq-review/database/review-content.sqlite`.
Run migrations and tracking checks from the workspace root:

```sh
pnpm database:migrate
pnpm database:tracking:check
```

The `findings` repository keeps cross-cutting observations separate from paper
comments. `append` creates an idempotent `todo` row with canonical source
provenance, `listTodo` returns only the active inbox in chronological order,
and `markProcessed` atomically records `processedAt` and `processedBy`. There is
no Jira URL field; external consumers own any onward Jira mapping.

## Resolve current-state outcomes

The read-only resolution command accepts one versioned JSON request on standard
input. Callers send the UUID, side, and current canonical RAG state for every
question side they want to synchronize:

```json
{
  "schemaVersion": 1,
  "targets": [
    {
      "uuid": "QUESTION-UUID",
      "side": "answer",
      "ragState": "rag_wf_ng2"
    }
  ]
}
```

Run the workspace command with pnpm's lifecycle output suppressed so standard
output contains only the response contract:

```sh
pnpm --silent review-outcomes:resolve
```

The command performs one read-only batch lookup and emits a single compact JSON
line. `matches` contains only outcomes whose UUID, side, and reviewed RAG state
exactly match a requested target:

```json
{
  "schemaVersion": 1,
  "matches": [
    {
      "uuid": "QUESTION-UUID",
      "side": "answer",
      "ragState": "rag_wf_ng2",
      "outcome": "PRG",
      "reviewer": "reviewer-name",
      "createdAt": "2026-09-09T10:00:00.000Z",
      "updatedAt": "2026-09-09T10:05:00.000Z"
    }
  ]
}
```

No match is represented by an empty `matches` array. Results are ordered by
UUID, side, and RAG state. Errors go to standard error with a non-zero exit
code. The resolver does not inspect canonical files, calculate transitions,
write TOML, call Google Sheets, or modify the review database.
