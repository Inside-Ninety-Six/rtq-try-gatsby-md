# RTQ Review API

Internal Ruby/Sinatra service for validating review actions and writing review
state to Google Sheets. It is an independently runnable application inside the
`rtq-review` workspace; Bundler continues to own its Ruby dependency graph.

## Setup

From the application directory:

```sh
bundle install
bundle check
```

The service reads the application-local `credentials.json`, `token.yaml`, and
`uuid.txt` files. Treat them as sensitive and do not print their contents or
copy their values into logs or documentation.

## Run

```sh
bundle exec ruby review.rb
```

The workspace adapter is equivalent:

```sh
pnpm dev
```

The maintained review stack expects the service at `http://localhost:4567`.
`RTQ_REVIEW_API_PUBLIC_HOSTS` preserves the existing comma-separated public
host authorization override used by the optional ngrok workflow.

The `POST /rag` and `POST /questionrag` endpoints accept the configured review
outcomes: `PRG`, `PRCR`, `PRCC`, `PRBD`, and `PRCS`. Retired outcomes are
rejected. Both endpoints also accept an empty `rag` string as an explicit
reset, which clears the existing review outcome cell after the normal UUID,
sheet, and content-state validation has succeeded. `PRNS` is the default state,
not another submitted trigger.

## Checks

```sh
pnpm dependencies:check
pnpm syntax:check
```

These commands validate the locked Bundler installation and Ruby syntax. They
do not contact Google Sheets or alter provider state.
