# RTQ Review Markdown Web

Internal Next.js application for reviewing generated RTQ answer Markdown. The
shared `@rtq/papers` review stack copies generated Markdown into `md/`. The
application serves external PaperImage binaries directly from the canonical
`rtq-content/packages/assets/assets/papers` tree; it does not use a local
paper-asset mirror. Generated LongDivision markup is already embedded in the
Markdown.

The review API defaults to `http://localhost:4567` and is available in this
workspace at `../review-api`. `pnpm dev:remote` uses the configured RTQ review
ngrok endpoint instead.

Use the
[RTQ development environment bootstrap](https://github.com/Read-The-Question/rtq-web/blob/develop/apps/web/docs/architecture/platform/rtq-web-bootstrap.md)
for the complete review-stack setup and startup sequence, and the
[RTQ repository landscape](https://github.com/Read-The-Question/rtq-web/blob/develop/apps/web/docs/architecture/platform/rtq-repository-landscape.md)
for this site's generated-Markdown and direct-asset ownership boundaries.
Its KaTeX macro path and current semantic-colour conformance are recorded in the
[RTQ KaTeX Semantic Colour Architecture](https://github.com/Read-The-Question/rtq-web/blob/develop/apps/web/docs/architecture/design-system/katex-semantic-colours.md).

## Requirements

- Node.js 24.19.0 (declared by the `rtq-review` workspace root)
- Corepack with pnpm 10.15.1
- A compatible sibling `rtq-content` checkout, or `RTQ_CONTENT_ROOT` set to
  that Git root

With nvm, run `nvm install` on first use and `nvm use` from the workspace root
later. Otherwise select Node 24.19.0 with your version manager. Enable the
package manager shim once on a new machine, then install the locked workspace
dependencies:

```bash
cd /path/to/rtq-review
corepack enable
pnpm install --frozen-lockfile
```

## Local use

```bash
cd /path/to/rtq-review
pnpm review-markdown-web:dev
```

Open `http://localhost:3004`. For the complete multi-repository workflow, start
the review stack from `rtq-content/packages/papers` so its
generated content and review services are prepared together. PaperImage
requests are resolved at request time from `@rtq/maths-assets`; adjacent JSON
and generated manifests remain server-only and cannot be requested through the
asset route.

Generated Markdown carries each authored `PaperList` style in a hidden inert
compatibility comment. Review Markdown Web consumes that metadata through the
shared review Markdown contract, removes it from output, and renders the same
native ordered or unordered list marker as the direct-content reviewers.

## Checks and production build

```bash
pnpm format:check
pnpm lint:check
pnpm types
pnpm test
pnpm build
```

Use `pnpm format:fix` and `pnpm lint:fix` for the corresponding safe automatic
fixes.
