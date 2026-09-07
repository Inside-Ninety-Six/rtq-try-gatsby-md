# RTQ review

`rtq-review` is the private pnpm workspace for RTQ's internal review tools.

All review renderers share the authoring meanings and conformance inventory in
the canonical
[RTQ KaTeX Semantic Colour Architecture](https://github.com/Read-The-Question/rtq-web/blob/develop/apps/web/docs/architecture/design-system/katex-semantic-colours.md).
Application-local documentation should link there rather than define another
maths-colour macro catalogue.

## Applications

- [`apps/docs-web`](apps/docs-web) is the internal Fumadocs application for
  reading selected documentation directly from the active RTQ repository
  working trees.
- [`apps/review-legacy-gatsby-web`](apps/review-legacy-gatsby-web) retains the
  generated-Markdown Gatsby reviewer. It is currently unused but remains the
  sole review consumer of copied paper assets until it is explicitly retired.
- [`apps/review-content-web`](apps/review-content-web) is the direct-content
  Next.js reviewer and the primary review application. It reads paper TOML
  from the active `rtq-content` checkout without generated Markdown, submits
  outcomes to Google Sheets through `review-api`, and keeps append-only
  comments in the versioned `database/review-content.sqlite` database in this
  repository.
- [`apps/review-markdown-web`](apps/review-markdown-web) is the maintained
  Next.js application for reviewing generated paper Markdown and submitting
  review actions.
- [`apps/review-tag-web`](apps/review-tag-web) is the maintained Next.js
  application for reviewing and editing tags directly in canonical paper TOML.
- [`apps/review-question-viewer-web`](apps/review-question-viewer-web) is the
  maintained Next.js application for displaying one selected canonical paper
  question.
- [`apps/review-api`](apps/review-api) is the Ruby/Sinatra service that
  validates review actions and writes review state to Google Sheets.

## Setup

From the repository root:

```sh
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
```

The workspace uses Node `24.19.0` and pnpm `10.15.1`.

The four maintained Next.js reviewers resolve a sibling `../rtq-content`
checkout from this workspace root. For a different layout, set
`RTQ_CONTENT_ROOT` to the whole `rtq-content` Git root. Absolute values are
accepted; relative values are resolved from this `rtq-review` workspace, not
from the command's current directory. The resolver validates
`@rtq/content-workspace`, `@rtq/papers`, and `@rtq/maths-assets` before use and
derives papers and assets from that one checkout.

Review Content Web exposes canonical paper TOML, the eight generated focus,
topic, and RAG collections, and exemplar tiers. Its five dimensional tag axes
use OR matching within an axis and AND matching across axes. Question and
answer RAG-state filters are independent. Filter state is encoded in the URL,
while display preferences are remembered in browser storage; Reset filters
clears both. Source TOML remains read-only: review outcomes go to Google Sheets
through Review API, while contextual append-only comments go to the local
SQLite database. The main database is committed with `rtq-review` so its
feedback can be read on other machines; SQLite journal, WAL, and SHM sidecars
remain ignored.

Run an application from the workspace root on its assigned port:

```sh
pnpm review-content-web:dev          # http://localhost:3001
pnpm review-tag-web:dev              # http://localhost:3002
pnpm review-question-viewer-web:dev  # http://localhost:3003
pnpm review-markdown-web:dev         # http://localhost:3004
pnpm docs-web:dev                    # http://localhost:3005/docs
pnpm review-api:dev                  # http://localhost:4567
pnpm review-legacy-gatsby-web:dev    # http://localhost:8000
```

Port `3000` remains reserved for the main RTQ website. Review Content Web uses
`3001`, Review Tag Web uses `3002`, Review Question Viewer uses `3003`, Review
Markdown Web uses `3004`, and Docs Web uses `3005`. Review API uses `4567`, and
the retained Gatsby application uses `8000`. See each application README for
its content, asset, and runtime prerequisites.

The same applications can be started from the workspace root:

```sh
pnpm docs-web:dev
pnpm review-markdown-web:dev
pnpm review-content-web:dev
pnpm review-tag-web:dev
pnpm review-question-viewer-web:dev
pnpm review-legacy-gatsby-web:dev
pnpm review-api:dev
```

The maintained Next.js commands use workspace-installed Node dependencies. The
API adapter deliberately delegates to Bundler; install its locked Ruby
dependencies from `apps/review-api` before starting it:

```sh
cd apps/review-api
bundle install
cd ../..
pnpm review-api:dependencies:check
pnpm review-api:syntax:check
```

The API reads its application-local credential, token, and UUID-index files.
Treat them as sensitive: do not print their contents or copy their values into
logs or documentation. The complete multi-service tmux workflow remains owned
by `rtq-content/packages/papers`. From that directory, start it. In a second
terminal, verify the three moved services from this workspace:

```sh
pnpm review-stack:start
```

```sh
cd ../../../rtq-review
pnpm review-stack:smoke
```
