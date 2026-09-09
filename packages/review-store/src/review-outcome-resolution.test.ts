import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { ReviewOutcomeRequestError, ReviewStoreDataError } from "./errors.ts";
import {
  resolveReviewOutcomeRequest,
  resolveReviewOutcomeRequestJson,
} from "./review-outcome-resolution.ts";
import { openReviewOutcomeReader, openReviewStore } from "./review-store.ts";
import type { ReviewOutcomeTarget } from "./types.ts";

function target(
  uuid: string,
  side: "answer" | "question",
  ragState: string,
): ReviewOutcomeTarget {
  return { ragState, side, uuid };
}

test("serializes an empty request as a stable named-field contract", () => {
  const store = openReviewStore({ databasePath: ":memory:" });
  assert.equal(
    resolveReviewOutcomeRequestJson(
      JSON.stringify({ schemaVersion: 1, targets: [] }),
      store.outcomes,
    ),
    '{"schemaVersion":1,"matches":[]}\n',
  );
  store.close();
});

test("returns only exact current-state matches in deterministic order", () => {
  const times = [
    new Date("2026-09-09T09:00:00.000Z"),
    new Date("2026-09-09T09:01:00.000Z"),
    new Date("2026-09-09T09:02:00.000Z"),
    new Date("2026-09-09T09:03:00.000Z"),
  ];
  let time = 0;
  const store = openReviewStore({
    databasePath: ":memory:",
    now: () => times[Math.min(time++, times.length - 1)],
  });
  store.outcomes.set({
    ...target("uuid-b", "answer", "rag_wf_ng1"),
    outcome: "PRG",
    reviewer: "reviewer-1",
  });
  store.outcomes.set({
    ...target("uuid-a", "question", "rag_wf_ng1"),
    outcome: "PRR",
    reviewer: "reviewer-2",
  });
  store.outcomes.set({
    ...target("uuid-a", "answer", "rag_wf_ng2"),
    outcome: "PRG2",
    reviewer: "reviewer-3",
  });
  store.outcomes.set({
    ...target("uuid-a", "answer", "rag_wf_ng1"),
    outcome: "STALE",
    reviewer: "reviewer-4",
  });

  const response = resolveReviewOutcomeRequest(
    {
      extraFutureField: true,
      schemaVersion: 1,
      targets: [
        target("uuid-b", "answer", "rag_wf_ng1"),
        target("uuid-a", "answer", "rag_wf_ng2"),
        target("uuid-a", "question", "rag_wf_ng1"),
        target("uuid-b", "question", "rag_wf_ng1"),
        target("uuid-a", "answer", "rag_wf_ng2"),
      ],
    },
    store.outcomes,
  );

  assert.deepEqual(
    response.matches.map(({ uuid, side, ragState, outcome }) => ({
      outcome,
      ragState,
      side,
      uuid,
    })),
    [
      {
        outcome: "PRG2",
        ragState: "rag_wf_ng2",
        side: "answer",
        uuid: "uuid-a",
      },
      {
        outcome: "PRR",
        ragState: "rag_wf_ng1",
        side: "question",
        uuid: "uuid-a",
      },
      {
        outcome: "PRG",
        ragState: "rag_wf_ng1",
        side: "answer",
        uuid: "uuid-b",
      },
    ],
  );
  store.close();
});

test("reflects replacement and reset semantics without changing stored rows", () => {
  const store = openReviewStore({ databasePath: ":memory:" });
  const selected = target("uuid-1", "answer", "rag_wf_ng1");
  store.outcomes.set({
    ...selected,
    outcome: "PRG",
    reviewer: "first",
  });
  store.outcomes.set({
    ...selected,
    outcome: "PRR",
    reviewer: "second",
  });
  assert.equal(store.outcomes.resolve([selected])[0]?.outcome, "PRR");
  assert.equal(store.outcomes.clear(selected), true);
  assert.deepEqual(store.outcomes.resolve([selected]), []);
  store.close();
});

test("resolves a large current-state batch and returns only actionable changes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtq-large-resolver-"));
  const databasePath = path.join(directory, "review.sqlite");
  const store = openReviewStore({ databasePath });
  store.close();

  const database = new Database(databasePath);
  const insert = database.prepare(
    `insert into review_outcomes
     (rtq_uuid, side, rag_state, outcome, reviewer, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  database.transaction(() => {
    for (let index = 0; index < 10_000; index += 1) {
      insert.run(
        `uuid-${String(index).padStart(5, "0")}`,
        "answer",
        "rag_wf_ng0",
        "STALE",
        "historical-reviewer",
        "2026-09-09T08:00:00.000Z",
        "2026-09-09T08:00:00.000Z",
      );
    }
    insert.run(
      "uuid-05000",
      "question",
      "rag_wf_ng2",
      "PRG",
      "reviewer-1",
      "2026-09-09T09:00:00.000Z",
      "2026-09-09T09:00:00.000Z",
    );
    insert.run(
      "uuid-09999",
      "answer",
      "rag_wf_ng3",
      "PRG2",
      "reviewer-2",
      "2026-09-09T09:00:00.000Z",
      "2026-09-09T09:00:00.000Z",
    );
  })();
  database.close();

  const targets = Array.from({ length: 10_000 }, (_, index) => {
    const uuid = `uuid-${String(index).padStart(5, "0")}`;
    return [
      target(uuid, "question", index === 5_000 ? "rag_wf_ng2" : "rag_wf_ng1"),
      target(uuid, "answer", index === 9_999 ? "rag_wf_ng3" : "rag_wf_ng1"),
    ];
  }).flat();

  const reader = openReviewOutcomeReader({ databasePath });
  const matches = reader.resolve(targets);
  assert.deepEqual(
    matches.map(({ uuid, side, outcome }) => ({ outcome, side, uuid })),
    [
      { outcome: "PRG", side: "question", uuid: "uuid-05000" },
      { outcome: "PRG2", side: "answer", uuid: "uuid-09999" },
    ],
  );
  reader.close();
  rmSync(directory, { force: true, recursive: true });
});

test("returns no payload rows when a large batch has no current-state changes", () => {
  const store = openReviewStore({ databasePath: ":memory:" });
  store.outcomes.set({
    ...target("uuid-stale", "answer", "rag_wf_ng1"),
    outcome: "PRG",
    reviewer: "reviewer",
  });
  const targets = Array.from({ length: 10_000 }, (_, index) =>
    target(`uuid-${index}`, "answer", "rag_wf_ng1"),
  );
  assert.deepEqual(store.outcomes.resolve(targets), []);
  store.close();
});

test("rejects malformed requests with the precise input location", () => {
  const store = openReviewStore({ databasePath: ":memory:" });
  assert.throws(
    () => resolveReviewOutcomeRequestJson("not-json", store.outcomes),
    (error: unknown) =>
      error instanceof ReviewOutcomeRequestError &&
      error.message === "Input must be valid JSON.",
  );
  assert.throws(
    () =>
      resolveReviewOutcomeRequest(
        {
          schemaVersion: 1,
          targets: [{ ragState: "rag_wf_ng1", side: "answer", uuid: "" }],
        },
        store.outcomes,
      ),
    (error: unknown) =>
      error instanceof ReviewOutcomeRequestError &&
      error.message.includes("targets[0].uuid"),
  );
  assert.throws(
    () =>
      resolveReviewOutcomeRequest(
        { schemaVersion: 2, targets: [] },
        store.outcomes,
      ),
    ReviewOutcomeRequestError,
  );
  store.close();
});

test("the read-only boundary reports invalid stored rows with identity context", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtq-outcome-reader-"));
  const databasePath = path.join(directory, "review.sqlite");
  const store = openReviewStore({ databasePath });
  store.close();

  const database = new Database(databasePath);
  database
    .prepare(
      `insert into review_outcomes
       (rtq_uuid, side, rag_state, outcome, reviewer, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "uuid-invalid",
      "answer",
      "rag_wf_ng1",
      "",
      "reviewer",
      "2026-09-09T10:00:00.000Z",
      "2026-09-09T10:00:00.000Z",
    );
  database.close();

  const reader = openReviewOutcomeReader({ databasePath });
  assert.throws(
    () => reader.resolve([target("uuid-invalid", "answer", "rag_wf_ng1")]),
    (error: unknown) =>
      error instanceof ReviewStoreDataError &&
      error.message.includes('uuid="uuid-invalid"') &&
      error.message.includes('field "outcome"'),
  );
  reader.close();
  rmSync(directory, { force: true, recursive: true });
});
