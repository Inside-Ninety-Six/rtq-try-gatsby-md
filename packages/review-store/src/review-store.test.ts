import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { REVIEW_WORKSPACE_ROOT } from "@rtq/review-repository-paths";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import {
  openReviewStore,
  ReviewCommentConflictError,
  ReviewDatabaseError,
  ReviewStoreValidationError,
} from "./index.ts";
import {
  REVIEW_DATABASE_PATH,
  REVIEW_MIGRATIONS_FOLDER,
} from "./review-store.ts";

test("resolves the shared database and package-owned migrations", () => {
  assert.equal(
    REVIEW_DATABASE_PATH,
    path.join(REVIEW_WORKSPACE_ROOT, "database", "review-content.sqlite"),
  );
  assert.equal(
    REVIEW_MIGRATIONS_FOLDER,
    path.resolve(import.meta.dirname, "../drizzle"),
  );
});

test("comments remain durable, chronological, idempotent, and state scoped", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtq-review-store-"));
  const databasePath = path.join(directory, "review.sqlite");
  const times = [
    new Date("2026-09-06T09:00:00.000Z"),
    new Date("2026-09-06T09:01:00.000Z"),
    new Date("2026-09-06T09:02:00.000Z"),
  ];
  let time = 0;
  const store = openReviewStore({
    databasePath,
    now: () => times[Math.min(time++, times.length - 1)],
  });
  const firstInput = {
    comment: "Check the unit conversion.",
    questionId: "paper:1:1",
    ragState: "rag_wf_ng3",
    reviewer: "up",
    side: "question" as const,
    submissionId: "submission-1",
    uuid: "uuid-1",
  };
  const first = store.comments.append(firstInput);
  const retry = store.comments.append(firstInput);
  const second = store.comments.append({
    ...firstInput,
    comment: "The explanation now needs a final read.",
    ragState: "rag_wf_ng4",
    submissionId: "submission-2",
  });
  store.comments.append({
    ...firstInput,
    comment: "Answer-side note.",
    side: "answer",
    submissionId: "submission-answer",
  });
  store.comments.append({
    ...firstInput,
    comment: "Nested-node feedback.",
    questionId: null,
    submissionId: "submission-nested",
    uuid: "uuid-nested",
  });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.comment.id, first.comment.id);
  assert.equal(second.created, true);
  assert.deepEqual(
    store.comments
      .listForTargets([
        { questionId: "paper:1:1", side: "question", uuid: "uuid-1" },
      ])
      .map((comment) => [comment.comment, comment.ragState]),
    [
      ["Check the unit conversion.", "rag_wf_ng3"],
      ["The explanation now needs a final read.", "rag_wf_ng4"],
    ],
  );
  assert.deepEqual(
    store.comments
      .listForTargets([
        { questionId: null, side: "question", uuid: "uuid-nested" },
      ])
      .map((comment) => comment.comment),
    ["Nested-node feedback."],
  );
  store.close();

  const reloaded = openReviewStore({ databasePath });
  assert.equal(
    reloaded.comments.listForTargets([
      { questionId: "paper:1:1", side: "question", uuid: "uuid-1" },
    ]).length,
    2,
  );
  reloaded.close();
  assert.throws(
    () =>
      reloaded.comments.listForTargets([
        { questionId: "paper:1:1", side: "question", uuid: "uuid-1" },
      ]),
    ReviewDatabaseError,
  );
  rmSync(directory, { force: true, recursive: true });
});

test("upgrades the existing comment schema without rewriting stored comments", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtq-review-upgrade-"));
  const databasePath = path.join(directory, "review.sqlite");
  const oldMigrations = path.join(directory, "old-migrations");
  const oldMeta = path.join(oldMigrations, "meta");
  mkdirSync(oldMeta, { recursive: true });
  for (const migration of [
    "0000_polite_thunderbolt_ross.sql",
    "0001_premium_snowbird.sql",
  ]) {
    copyFileSync(
      path.join(REVIEW_MIGRATIONS_FOLDER, migration),
      path.join(oldMigrations, migration),
    );
  }
  const journal = JSON.parse(
    readFileSync(
      path.join(REVIEW_MIGRATIONS_FOLDER, "meta/_journal.json"),
      "utf8",
    ),
  ) as { dialect: string; entries: unknown[]; version: string };
  writeFileSync(
    path.join(oldMeta, "_journal.json"),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }, null, 2)}\n`,
  );

  const oldDatabase = new Database(databasePath);
  migrate(drizzle(oldDatabase), { migrationsFolder: oldMigrations });
  oldDatabase
    .prepare(
      `insert into review_comments
       (id, submission_id, rtq_question_id, rtq_uuid, side, rag_state, comment, reviewer, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "comment-before-outcomes",
      "before-outcomes",
      "paper:1:1",
      "uuid-existing",
      "question",
      "rag_wf_g1",
      "Preserve this existing row.",
      "up",
      "2026-09-09T08:00:00.000Z",
    );
  oldDatabase.close();

  const upgraded = openReviewStore({ databasePath });
  assert.equal(
    upgraded.comments.listForTargets([
      { questionId: "paper:1:1", side: "question", uuid: "uuid-existing" },
    ])[0]?.comment,
    "Preserve this existing row.",
  );
  assert.deepEqual(upgraded.outcomes.listAll(), []);
  upgraded.close();
  rmSync(directory, { force: true, recursive: true });
});

test("comments reject a reused submission ID with different content", () => {
  const store = openReviewStore({ databasePath: ":memory:" });
  const input = {
    comment: "First comment",
    questionId: "q1",
    ragState: "rag_wf_g2",
    reviewer: "up",
    side: "answer" as const,
    submissionId: "same-submission",
    uuid: "uuid-1",
  };
  store.comments.append(input);
  assert.throws(
    () => store.comments.append({ ...input, comment: "Different comment" }),
    ReviewCommentConflictError,
  );
  store.close();
});

test("outcomes replace within one identity and state without consumption flags", () => {
  const times = [
    new Date("2026-09-09T08:00:00.000Z"),
    new Date("2026-09-09T08:01:00.000Z"),
    new Date("2026-09-09T08:02:00.000Z"),
  ];
  let time = 0;
  const store = openReviewStore({
    databasePath: ":memory:",
    now: () => times[Math.min(time++, times.length - 1)],
  });
  const target = {
    ragState: "rag_wf_g1",
    side: "answer" as const,
    uuid: "uuid-1",
  };

  const first = store.outcomes.set({
    ...target,
    outcome: "PRG",
    reviewer: "reviewer-1",
  });
  const replacement = store.outcomes.set({
    ...target,
    outcome: "PRCR",
    reviewer: "reviewer-2",
  });
  store.outcomes.set({
    ...target,
    ragState: "rag_wf_g2",
    outcome: "PRCC",
    reviewer: "reviewer-3",
  });
  store.outcomes.set({
    ...target,
    side: "question",
    outcome: "PRG",
    reviewer: "reviewer-4",
  });

  assert.equal(replacement.createdAt, first.createdAt);
  assert.equal(replacement.updatedAt, "2026-09-09T08:01:00.000Z");
  assert.equal(store.outcomes.get(target)?.outcome, "PRCR");
  assert.equal(
    store.outcomes.get({ ...target, ragState: "rag_wf_g2" })?.outcome,
    "PRCC",
  );
  assert.equal(
    store.outcomes.get({ ...target, side: "question" })?.reviewer,
    "reviewer-4",
  );
  assert.deepEqual(
    store.outcomes
      .listAll()
      .map((outcome) => [outcome.uuid, outcome.side, outcome.ragState]),
    [
      ["uuid-1", "answer", "rag_wf_g1"],
      ["uuid-1", "answer", "rag_wf_g2"],
      ["uuid-1", "question", "rag_wf_g1"],
    ],
  );
  assert.deepEqual(Object.keys(replacement).sort(), [
    "createdAt",
    "outcome",
    "ragState",
    "reviewer",
    "side",
    "updatedAt",
    "uuid",
  ]);
  assert.equal(store.outcomes.clear(target), true);
  assert.equal(store.outcomes.clear(target), false);
  assert.equal(store.outcomes.get(target), undefined);
  assert.equal(store.outcomes.listAll().length, 2);
  store.close();
});

test("outcomes persist and reject malformed writes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "rtq-review-outcomes-"));
  const databasePath = path.join(directory, "review.sqlite");
  const store = openReviewStore({ databasePath });
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "" as "PRG",
        ragState: "rag_wf_g1",
        reviewer: "up",
        side: "question",
        uuid: "uuid-1",
      }),
    ReviewStoreValidationError,
  );
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "PRR" as "PRG",
        ragState: "rag_wf_g1",
        reviewer: "up",
        side: "question",
        uuid: "uuid-1",
      }),
    (error: unknown) =>
      error instanceof ReviewStoreValidationError &&
      error.message.includes("PRNS, PRG, PRBD, PRCS, PRCR, PRCC"),
  );
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "PRG",
        ragState: "rag_wf_g1",
        reviewer: "up",
        side: "question",
        uuid: " ",
      }),
    ReviewStoreValidationError,
  );
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "PRG",
        ragState: " ",
        reviewer: "up",
        side: "question",
        uuid: "uuid-1",
      }),
    ReviewStoreValidationError,
  );
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "PRG",
        ragState: "rag_wf_g1",
        reviewer: " ",
        side: "question",
        uuid: "uuid-1",
      }),
    ReviewStoreValidationError,
  );
  assert.throws(
    () =>
      store.outcomes.set({
        outcome: "PRG",
        ragState: "rag_wf_g1",
        reviewer: "up",
        side: "invalid" as "question",
        uuid: "uuid-1",
      }),
    ReviewStoreValidationError,
  );
  store.outcomes.set({
    outcome: "PRG",
    ragState: "rag_wf_g1",
    reviewer: "up",
    side: "question",
    uuid: "uuid-1",
  });
  store.close();

  const reloaded = openReviewStore({ databasePath });
  assert.equal(
    reloaded.outcomes.get({
      ragState: "rag_wf_g1",
      side: "question",
      uuid: "uuid-1",
    })?.outcome,
    "PRG",
  );
  reloaded.close();
  rmSync(directory, { force: true, recursive: true });
});

test("migration failures are exposed as recoverable store errors", () => {
  assert.throws(
    () =>
      openReviewStore({
        databasePath: ":memory:",
        migrationsFolder: path.join(tmpdir(), "missing-rtq-migrations"),
      }),
    ReviewDatabaseError,
  );
});
